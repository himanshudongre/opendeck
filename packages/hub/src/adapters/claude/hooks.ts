import { basename } from 'node:path';
import { z } from 'zod';
import type { Hub } from '../../core/hub.js';
import { logger } from '../../logger.js';
import { diffForTool, prettyToolDetail, prettyToolInput, truncate } from '../pretty.js';

/**
 * Loose schemas for Claude Code hook POST bodies (verified against the
 * installed CLI's schema, which the Agent SDK types mirror). Loose on
 * purpose: unknown fields and future hook events must never break the hub.
 */
const HookBaseSchema = z.object({
  session_id: z.string().min(1),
  cwd: z.string(),
  hook_event_name: z.string(),
});

const HookEventSchema = HookBaseSchema.passthrough().and(
  z.object({
    source: z.string().optional(),
    session_title: z.string().optional(),
    model: z.string().optional(),
    prompt: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_use_id: z.string().optional(),
    notification_type: z.string().optional(),
    message: z.string().optional(),
    reason: z.string().optional(),
    last_assistant_message: z.string().optional(),
    permission_suggestions: z.array(z.unknown()).optional(),
  }),
);
export type ClaudeHookEvent = z.infer<typeof HookEventSchema>;

/** Default cap on how long a terminal permission waits for a deck answer. */
export const PERMISSION_WAIT_MS = 300_000;

export interface HooksGatewayOptions {
  permissionWaitMs?: number;
  /** Managed sessions also emit hooks in some setups; skip their native ids. */
  isManagedNativeId?: (nativeSessionId: string) => boolean;
  readFile?: (path: string) => string | undefined;
}

export type HookHttpResponse = { status: 200; body: Record<string, unknown> } | { status: 204 };

/**
 * Observed-mode Claude sessions (SPEC §4.1): the user's own terminal reports
 * lifecycle events via hook POSTs, and PermissionRequest hooks wait for a
 * deck decision so even terminal sessions get deck approvals.
 */
export class ClaudeHooksGateway {
  private readonly known = new Set<string>();

  constructor(
    private readonly hub: Hub,
    private readonly options: HooksGatewayOptions = {},
  ) {}

  async handle(payload: unknown): Promise<HookHttpResponse> {
    const parsed = HookEventSchema.safeParse(payload);
    if (!parsed.success) {
      logger().warn({ issues: parsed.error.issues.length }, 'unparseable claude hook payload');
      return { status: 204 };
    }
    const event = parsed.data;
    if (this.options.isManagedNativeId?.(event.session_id) === true) return { status: 204 };

    const sessionId = `claude-obs-${event.session_id}`;
    if (event.hook_event_name !== 'SessionEnd') this.ensureSession(sessionId, event);

    switch (event.hook_event_name) {
      case 'SessionStart':
        this.hub.setStatus(sessionId, 'idle');
        return { status: 204 };
      case 'UserPromptSubmit':
        if (event.prompt !== undefined) {
          this.hub.transcript(sessionId, 'user', truncate(event.prompt, 500), true);
        }
        this.hub.setStatus(sessionId, 'thinking');
        return { status: 204 };
      case 'PreToolUse': {
        const name = event.tool_name ?? 'Tool';
        const tool = { name, detail: prettyToolDetail(name, event.tool_input) };
        this.hub.setStatus(sessionId, 'working', tool);
        this.hub.toolEvent(sessionId, 'start', tool);
        return { status: 204 };
      }
      case 'PostToolUse': {
        const name = event.tool_name ?? 'Tool';
        this.hub.toolEvent(sessionId, 'end', {
          name,
          detail: prettyToolDetail(name, event.tool_input),
        });
        return { status: 204 };
      }
      case 'Notification':
        if (event.notification_type === 'permission_prompt') {
          this.hub.setStatus(sessionId, 'waiting_permission');
        } else if (event.notification_type === 'idle_prompt') {
          this.hub.setStatus(sessionId, 'waiting_input');
        }
        return { status: 204 };
      case 'Stop':
        if (event.last_assistant_message !== undefined && event.last_assistant_message.length > 0) {
          this.hub.transcript(
            sessionId,
            'assistant',
            truncate(event.last_assistant_message, 500),
            true,
          );
        }
        this.hub.setStatus(sessionId, 'done');
        return { status: 204 };
      case 'SessionEnd':
        this.hub.removeSession(sessionId);
        this.known.delete(sessionId);
        return { status: 204 };
      case 'PermissionRequest':
        return this.handlePermission(sessionId, event);
      default:
        return { status: 204 };
    }
  }

  private async handlePermission(
    sessionId: string,
    event: ClaudeHookEvent,
  ): Promise<HookHttpResponse> {
    // Nobody is looking at a deck — fall straight back to the terminal prompt.
    if (!this.hub.hasClients()) return { status: 204 };

    const name = event.tool_name ?? 'Tool';
    const diff = diffForTool(name, event.tool_input, this.options.readFile);
    const { id, resolution } = this.hub.requestPermission(sessionId, {
      name,
      input: prettyToolInput(name, event.tool_input),
      ...(diff === undefined ? {} : { diff }),
    });

    const waitMs = this.options.permissionWaitMs ?? PERMISSION_WAIT_MS;
    const decision = await Promise.race([
      resolution.then((value) => ({ kind: 'answered' as const, value })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        const timer = setTimeout(() => resolve({ kind: 'timeout' }), waitMs);
        timer.unref();
      }),
    ]);

    if (decision.kind === 'timeout') {
      this.hub.resolvePermissionFromHarness(id, 'dismissed');
      this.hub.setStatus(sessionId, 'waiting_permission');
      return { status: 204 };
    }

    this.hub.setStatus(sessionId, 'working');
    if (decision.value === 'deny') {
      return {
        status: 200,
        body: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'deny', message: 'Denied from the OpenDeck deck.' },
          },
        },
      };
    }
    const allow: Record<string, unknown> = { behavior: 'allow' };
    if (decision.value === 'always_allow' && event.permission_suggestions !== undefined) {
      allow.updatedPermissions = event.permission_suggestions;
    }
    return {
      status: 200,
      body: {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: allow },
      },
    };
  }

  private ensureSession(sessionId: string, event: ClaudeHookEvent): void {
    if (this.known.has(sessionId)) return;
    this.known.add(sessionId);
    const now = Date.now();
    this.hub.upsertSession(
      {
        id: sessionId,
        hubId: this.hub.hubId,
        harness: 'claude',
        mode: 'observed',
        title: event.session_title ?? basename(event.cwd),
        cwd: event.cwd,
        ...(event.model === undefined ? {} : { model: event.model }),
        status: 'idle',
        statusSince: now,
        lastActivity: now,
        stats: { inputTokens: 0, outputTokens: 0, turns: 0, elapsedMs: 0 },
        capabilities: ['approve'],
      },
      {},
    );
  }
}
