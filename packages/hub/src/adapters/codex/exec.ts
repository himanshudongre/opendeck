import { basename } from 'node:path';
import { execa } from 'execa';
import type { Hub } from '../../core/hub.js';
import { newId } from '../../ids.js';
import { logger } from '../../logger.js';
import { hubSink } from '../sink.js';
import type { Adapter, DetectResult, ManagedSession, SpawnOpts } from '../types.js';
import { CodexStreamNormalizer } from './events.js';

/** Reasoning-effort detents for the Codex dial (SPEC §4.2). */
export const CODEX_EFFORT_DETENTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

/** Sandbox policy presets selectable from the deck. */
export const CODEX_SANDBOX_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'];

export interface CodexTurnHandle {
  lines: AsyncIterable<string>;
  kill: () => void;
  done: Promise<{ exitCode: number | undefined }>;
}

/** Injectable process boundary so the contract suite can replay fixtures. */
export type CodexRunner = (args: string[], cwd: string) => CodexTurnHandle;

function realRunner(args: string[], cwd: string): CodexTurnHandle {
  const child = execa('codex', args, { cwd, reject: false, buffer: false });
  return {
    lines: child.iterable({ from: 'stdout' }),
    kill: () => {
      child.kill();
    },
    done: child.then((result) => ({
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : undefined,
    })),
  };
}

export interface CodexAdapterDeps {
  runner?: CodexRunner;
}

export class CodexAdapter implements Adapter {
  readonly harness = 'codex';
  private readonly sessions = new Map<string, CodexSession>();
  private readonly runner: CodexRunner;

  constructor(
    private readonly hub: Hub,
    deps: CodexAdapterDeps = {},
  ) {
    this.runner = deps.runner ?? realRunner;
  }

  async detect(): Promise<DetectResult> {
    let version: string;
    try {
      const result = await execa('codex', ['--version'], { timeout: 10_000 });
      version = result.stdout.trim().replace(/^codex(-cli)?\s*/i, '');
    } catch {
      return { installed: false, note: 'Codex not installed' };
    }
    try {
      const help = await execa('codex', ['exec', '--help'], { timeout: 10_000 });
      if (!help.stdout.includes('--json')) {
        return {
          installed: true,
          version,
          note: `Codex ${version} detected, but \`codex exec --json\` is unavailable — managed sessions disabled`,
        };
      }
    } catch {
      return {
        installed: true,
        version,
        note: `Codex ${version} detected, but \`codex exec\` failed — managed sessions disabled`,
      };
    }
    return { installed: true, version, note: `Codex ${version} detected` };
  }

  spawn(opts: SpawnOpts): Promise<ManagedSession> {
    const session = new CodexSession(this.hub, this.runner, opts);
    this.sessions.set(session.id, session);
    session.register();
    if (opts.prompt !== undefined) session.startTurn(opts.prompt);
    return Promise.resolve({ sessionId: session.id });
  }

  attachObservers(): Promise<void> {
    // Codex has no hook surface to observe; managed mode only (SPEC §4.2).
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    for (const session of this.sessions.values()) session.kill();
    this.sessions.clear();
    return Promise.resolve();
  }
}

export class CodexSession {
  readonly id = newId('codex');
  private readonly normalizer;
  private effort = 'medium';
  private sandbox = 'workspace-write';
  private turn: CodexTurnHandle | undefined;
  private killed = false;

  constructor(
    private readonly hub: Hub,
    private readonly runner: CodexRunner,
    private readonly opts: SpawnOpts,
  ) {
    this.normalizer = new CodexStreamNormalizer(hubSink(hub, this.id));
    if (opts.resumeSessionId !== undefined) this.normalizer.threadId = opts.resumeSessionId;
  }

  register(): void {
    const now = Date.now();
    this.hub.upsertSession(
      {
        id: this.id,
        hubId: this.hub.hubId,
        harness: 'codex',
        mode: 'managed',
        title:
          this.opts.prompt === undefined
            ? basename(this.opts.cwd)
            : (this.opts.prompt.split('\n')[0] ?? '').slice(0, 60),
        cwd: this.opts.cwd,
        ...(this.opts.model === undefined ? {} : { model: this.opts.model }),
        status: 'idle',
        statusSince: now,
        lastActivity: now,
        stats: { inputTokens: 0, outputTokens: 0, turns: 0, elapsedMs: 0 },
        capabilities: ['prompt', 'interrupt', 'set_effort', 'resume', 'kill', 'transcript'],
      },
      {
        prompt: (text) => {
          this.startTurn(text);
        },
        interrupt: () => {
          this.turn?.kill();
          this.hub.setStatus(this.id, 'idle');
        },
        setEffort: (payload) => {
          if (payload.axis !== 'effort') {
            throw new Error('Codex sessions take the effort axis.');
          }
          if (!CODEX_EFFORT_DETENTS.includes(payload.value)) {
            throw new Error(`Unknown reasoning effort: ${payload.value}`);
          }
          this.effort = payload.value;
          this.hub.notice(
            this.id,
            'info',
            `Reasoning effort set to ${payload.value} for the next turn`,
          );
          return payload.value;
        },
        resume: () => {
          if (this.normalizer.threadId === undefined) {
            throw new Error('Nothing to resume yet.');
          }
          this.startTurn('Continue where you left off.');
        },
        kill: () => {
          this.kill();
        },
        runAction: (action) => {
          const preset = action.args?.sandbox;
          if (action.kind === 'custom' && typeof preset === 'string') {
            if (!CODEX_SANDBOX_PRESETS.includes(preset)) {
              throw new Error(`Unknown sandbox preset: ${preset}`);
            }
            this.sandbox = preset;
            this.hub.notice(this.id, 'info', `Sandbox set to ${preset} for the next turn`);
            return;
          }
          throw new Error('Codex sessions support the sandbox custom action.');
        },
      },
    );
  }

  buildArgs(prompt: string): string[] {
    const args = ['exec'];
    if (this.normalizer.threadId !== undefined) args.push('resume', this.normalizer.threadId);
    args.push('--json', '--sandbox', this.sandbox, '-c', `model_reasoning_effort=${this.effort}`);
    if (this.opts.model !== undefined) args.push('-c', `model=${this.opts.model}`);
    args.push(prompt);
    return args;
  }

  startTurn(prompt: string): void {
    if (this.turn !== undefined) {
      this.hub.notice(this.id, 'warn', 'A turn is already running. Interrupt it first.');
      return;
    }
    this.hub.transcript(this.id, 'user', prompt, true);
    this.hub.setStatus(this.id, 'thinking');
    const turn = this.runner(this.buildArgs(prompt), this.opts.cwd);
    this.turn = turn;
    void this.consume(turn);
  }

  kill(): void {
    this.killed = true;
    this.turn?.kill();
    this.hub.removeSession(this.id);
  }

  private async consume(turn: CodexTurnHandle): Promise<void> {
    try {
      for await (const line of turn.lines) {
        this.normalizer.handleLine(line);
      }
      const { exitCode } = await turn.done;
      if (!this.killed && exitCode !== undefined && exitCode !== 0) {
        this.hub.notice(this.id, 'error', `codex exec exited with code ${exitCode}`);
        this.hub.setStatus(this.id, 'error');
      }
    } catch (error) {
      if (!this.killed) {
        logger().error({ err: error, sessionId: this.id }, 'codex turn failed');
        this.hub.notice(this.id, 'error', 'The Codex turn crashed. Check the hub logs.');
        this.hub.setStatus(this.id, 'error');
      }
    } finally {
      this.turn = undefined;
    }
  }
}
