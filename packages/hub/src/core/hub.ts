import {
  PROTOCOL_VERSION,
  type Action,
  type ClientMsg,
  type CurrentTool,
  type ErrorCode,
  type HelloPayload,
  type PermissionRequest,
  type PermissionResolution,
  type PermissionResolved,
  type ServerMsg,
  type Session,
  type SessionStats,
  type SessionStatus,
} from '@agentdeck/protocol';
import type { CustomAction } from '../config.js';
import { newId } from '../ids.js';
import { EventBus } from './event-bus.js';
import { ReplayBuffer } from './replay-buffer.js';
import { SessionRegistry, type SessionController } from './session-registry.js';

export interface HubEvents extends Record<string, unknown> {
  /** Every broadcastable message, exactly once, in seq order. */
  broadcast: ServerMsg;
}

export type ShellRunner = (action: CustomAction) => Promise<{ ok: boolean; output: string }>;

export interface HubOptions {
  hubId?: string;
  version: string;
  bufferCapacity?: number;
  customActions?: CustomAction[];
  /** Injected so core stays process-free and tests stay hermetic. */
  runShell?: ShellRunner;
  /** Spawns a managed session for a `new_session` deck action. */
  spawnSession?: (args: Record<string, string | number | boolean>) => Promise<void>;
  now?: () => number;
}

export type DispatchResult =
  | { ok: true; data?: Record<string, string | number | boolean> }
  | { ok: false; code: ErrorCode; message: string };

interface PendingPermission {
  request: PermissionRequest;
  resolve: (resolution: PermissionResolution) => void;
}

/**
 * The hub core: session registry + event bus + replay buffer, with the
 * permission round-trip in the middle. Transports (WS/REST) and adapters both
 * talk to this and never to each other.
 */
export class Hub {
  readonly hubId: string;
  readonly version: string;
  readonly bus = new EventBus<HubEvents>();

  private readonly registry = new SessionRegistry();
  private readonly buffer: ReplayBuffer;
  private readonly pending = new Map<string, PendingPermission>();
  private readonly customActions: CustomAction[];
  private readonly runShell: ShellRunner | undefined;
  private readonly spawnSession:
    ((args: Record<string, string | number | boolean>) => Promise<void>) | undefined;
  private readonly now: () => number;
  private seq = 0;
  private connectedClients = 0;

  constructor(options: HubOptions) {
    this.hubId = options.hubId ?? newId('hub');
    this.version = options.version;
    this.buffer = new ReplayBuffer(options.bufferCapacity ?? 1000);
    this.customActions = options.customActions ?? [];
    this.runShell = options.runShell;
    this.spawnSession = options.spawnSession;
    this.now = options.now ?? Date.now;
  }

  /** Connected deck clients, maintained by the socket layer. */
  clientConnected(): void {
    this.connectedClients += 1;
  }

  clientDisconnected(): void {
    this.connectedClients = Math.max(0, this.connectedClients - 1);
  }

  hasClients(): boolean {
    return this.connectedClients > 0;
  }

  // -------------------------------------------------------------------------
  // Adapter-facing API
  // -------------------------------------------------------------------------

  upsertSession(session: Session, controller: SessionController): void {
    this.registry.register(session, controller);
    this.broadcast('session_upsert', session, session.id);
  }

  patchSession(sessionId: string, patch: Partial<Session>): void {
    const updated = this.registry.patch(sessionId, { ...patch, lastActivity: this.now() });
    if (updated) this.broadcast('session_upsert', updated, sessionId);
  }

  removeSession(sessionId: string): void {
    if (!this.registry.remove(sessionId)) return;
    this.dismissPermissions(sessionId);
    this.broadcast('session_removed', { sessionId }, sessionId);
  }

  setStatus(sessionId: string, status: SessionStatus, currentTool?: CurrentTool): void {
    const ts = this.now();
    const patch: Partial<Session> = currentTool
      ? { status, statusSince: ts, currentTool }
      : { status, statusSince: ts };
    const updated = this.registry.patch(sessionId, { ...patch, lastActivity: ts });
    if (!updated) return;
    this.broadcast(
      'event',
      currentTool
        ? { kind: 'status', sessionId, status, statusSince: ts, currentTool }
        : { kind: 'status', sessionId, status, statusSince: ts },
      sessionId,
    );
  }

  transcript(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    text: string,
    done: boolean,
  ): void {
    if (!this.registry.get(sessionId)) return;
    this.broadcast('event', { kind: 'transcript', sessionId, role, text, done }, sessionId);
  }

  toolEvent(sessionId: string, phase: 'start' | 'end', tool: CurrentTool, ok?: boolean): void {
    if (!this.registry.get(sessionId)) return;
    if (phase === 'start') {
      this.registry.patch(sessionId, { currentTool: tool, lastActivity: this.now() });
    }
    this.broadcast(
      'event',
      ok === undefined
        ? { kind: 'tool', sessionId, phase, tool }
        : { kind: 'tool', sessionId, phase, tool, ok },
      sessionId,
    );
  }

  updateStats(sessionId: string, stats: SessionStats): void {
    const updated = this.registry.patch(sessionId, { stats, lastActivity: this.now() });
    if (!updated) return;
    this.broadcast('event', { kind: 'stats', sessionId, stats }, sessionId);
  }

  notice(sessionId: string, level: 'info' | 'warn' | 'error', text: string): void {
    if (!this.registry.get(sessionId)) return;
    this.broadcast('event', { kind: 'notice', sessionId, level, text }, sessionId);
  }

  /**
   * The approval round-trip. Broadcasts a permission_request, flips the
   * session to waiting_permission, and resolves when a deck answers (or the
   * harness resolves it out from under us). No timeout by default (SPEC §4.1).
   */
  requestPermission(
    sessionId: string,
    tool: PermissionRequest['tool'],
    options: PermissionRequest['options'] = ['approve', 'deny', 'always_allow'],
  ): { id: string; resolution: Promise<PermissionResolution> } {
    const request: PermissionRequest = {
      id: newId('perm'),
      sessionId,
      tool,
      options,
      requestedAt: this.now(),
    };
    const resolution = new Promise<PermissionResolution>((resolve) => {
      this.pending.set(request.id, { request, resolve });
    });
    this.setStatus(sessionId, 'waiting_permission');
    this.broadcast('permission_request', request, sessionId);
    return { id: request.id, resolution };
  }

  /** Harness answered on its own side (e.g. in the terminal). */
  resolvePermissionFromHarness(requestId: string, outcome: PermissionResolved['outcome']): void {
    this.finishPermission(requestId, outcome, 'harness');
  }

  pendingPermissionsFor(sessionId: string): PermissionRequest[] {
    return [...this.pending.values()]
      .filter((entry) => entry.request.sessionId === sessionId)
      .map((entry) => entry.request);
  }

  // -------------------------------------------------------------------------
  // Client-facing API
  // -------------------------------------------------------------------------

  snapshot(): Session[] {
    return this.registry.list();
  }

  currentSeq(): number {
    return this.seq;
  }

  helloPayload(resume: HelloPayload['resume']): HelloPayload {
    return {
      hubId: this.hubId,
      hubVersion: this.version,
      seq: this.seq,
      sessions: this.snapshot(),
      resume,
    };
  }

  replaySince(lastSeq: number): ServerMsg[] | undefined {
    const result = this.buffer.replaySince(lastSeq);
    return result.ok ? result.msgs : undefined;
  }

  /** Connection-independent client messages. Returns what to ack or reject. */
  async dispatch(msg: ClientMsg): Promise<DispatchResult> {
    try {
      return await this.dispatchInner(msg);
    } catch (error) {
      // Controllers throw on invalid values (a dial detent the harness
      // doesn't have); that's the deck's mistake, not a hub failure.
      return {
        ok: false,
        code: 'bad_message',
        message: error instanceof Error ? error.message : 'The adapter rejected that request.',
      };
    }
  }

  private async dispatchInner(msg: ClientMsg): Promise<DispatchResult> {
    switch (msg.type) {
      case 'action':
        return this.runAction(msg.payload);
      case 'permission_response': {
        const done = this.finishPermission(msg.payload.requestId, msg.payload.resolution, 'deck');
        return done
          ? { ok: true }
          : { ok: false, code: 'unknown_session', message: 'That permission request is gone.' };
      }
      case 'set_effort': {
        const controller = this.registry.controller(msg.payload.sessionId);
        if (!controller) return this.unknownSession(msg.payload.sessionId);
        if (!controller.setEffort) return this.unsupported('set_effort');
        const applied = await controller.setEffort(msg.payload);
        return { ok: true, data: { axis: msg.payload.axis, value: applied } };
      }
      case 'prompt':
      case 'voice_prompt': {
        const controller = this.registry.controller(msg.payload.sessionId);
        if (!controller) return this.unknownSession(msg.payload.sessionId);
        if (!controller.prompt) return this.unsupported('prompt');
        await controller.prompt(msg.payload.text);
        return { ok: true };
      }
      case 'subscribe':
      case 'ping':
      case 'resume':
        return {
          ok: false,
          code: 'bad_message',
          message: `${msg.type} is connection-scoped and handled by the socket layer.`,
        };
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async runAction(action: Action): Promise<DispatchResult> {
    switch (action.kind) {
      case 'approve':
      case 'deny':
      case 'always_allow': {
        if (!action.sessionId) return this.needsSession(action.kind);
        const pending = this.pendingPermissionsFor(action.sessionId)[0];
        if (!pending) {
          return {
            ok: false,
            code: 'unknown_session',
            message: 'Nothing is waiting for approval.',
          };
        }
        this.finishPermission(pending.id, action.kind, 'deck');
        return { ok: true };
      }
      case 'interrupt':
      case 'kill':
      case 'resume': {
        if (!action.sessionId) return this.needsSession(action.kind);
        const controller = this.registry.controller(action.sessionId);
        if (!controller) return this.unknownSession(action.sessionId);
        const fn = controller[action.kind];
        if (!fn) return this.unsupported(action.kind);
        await fn.call(controller);
        return { ok: true };
      }
      case 'prompt_template': {
        if (!action.sessionId) return this.needsSession(action.kind);
        const controller = this.registry.controller(action.sessionId);
        if (!controller) return this.unknownSession(action.sessionId);
        if (!controller.prompt) return this.unsupported('prompt');
        const text = action.args?.text;
        if (typeof text !== 'string' || text.length === 0) {
          return { ok: false, code: 'bad_message', message: 'prompt_template needs args.text.' };
        }
        await controller.prompt(text);
        return { ok: true };
      }
      case 'shell': {
        const id = action.args?.actionId;
        const custom = this.customActions.find((entry) => entry.id === id);
        if (!custom) {
          return {
            ok: false,
            code: 'unsupported',
            message: 'Shell actions must be defined in ~/.agentdeck/config.json.',
          };
        }
        if (action.args?.confirmed !== true) {
          return {
            ok: false,
            code: 'bad_message',
            message: 'Shell actions require a confirm tap.',
          };
        }
        if (!this.runShell) return this.unsupported('shell');
        const result = await this.runShell(custom);
        if (action.sessionId && this.registry.get(action.sessionId)) {
          this.notice(
            action.sessionId,
            result.ok ? 'info' : 'error',
            `${custom.label}: ${result.output.slice(0, 200)}`,
          );
        }
        return result.ok
          ? { ok: true, data: { output: result.output.slice(0, 2000) } }
          : {
              ok: false,
              code: 'internal',
              message: `${custom.label} failed: ${result.output.slice(0, 500)}`,
            };
      }
      case 'new_session': {
        if (!this.spawnSession) return this.unsupported('new_session');
        await this.spawnSession(action.args ?? {});
        return { ok: true };
      }
      case 'compact':
      case 'custom': {
        if (!action.sessionId) return this.needsSession(action.kind);
        const controller = this.registry.controller(action.sessionId);
        if (!controller) return this.unknownSession(action.sessionId);
        if (!controller.runAction) return this.unsupported(action.kind);
        await controller.runAction(action);
        return { ok: true };
      }
    }
  }

  private finishPermission(
    requestId: string,
    outcome: PermissionResolved['outcome'],
    source: PermissionResolved['source'],
  ): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    if (outcome !== 'dismissed') entry.resolve(outcome);
    this.broadcast(
      'permission_resolved',
      { requestId, sessionId: entry.request.sessionId, outcome, source },
      entry.request.sessionId,
    );
    return true;
  }

  private dismissPermissions(sessionId: string): void {
    for (const request of this.pendingPermissionsFor(sessionId)) {
      this.finishPermission(request.id, 'dismissed', 'harness');
    }
  }

  private broadcast<
    T extends
      'session_upsert' | 'session_removed' | 'event' | 'permission_request' | 'permission_resolved',
  >(type: T, payload: Extract<ServerMsg, { type: T }>['payload'], sessionId: string): void {
    this.seq += 1;
    const msg = {
      v: PROTOCOL_VERSION,
      seq: this.seq,
      ts: this.now(),
      type,
      payload,
    } as ServerMsg;
    this.buffer.record(sessionId, msg);
    this.bus.emit('broadcast', msg);
  }

  private unknownSession(sessionId: string): DispatchResult {
    return { ok: false, code: 'unknown_session', message: `Session ${sessionId} is gone.` };
  }

  private unsupported(what: string): DispatchResult {
    return { ok: false, code: 'unsupported', message: `This session can't ${what}.` };
  }

  private needsSession(kind: string): DispatchResult {
    return { ok: false, code: 'bad_message', message: `${kind} needs a sessionId.` };
  }
}
