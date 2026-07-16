import type {
  CurrentTool,
  PermissionResolution,
  Session,
  SessionStats,
  SessionStatus,
} from '@agentdeck/protocol';
import type { SimHost, SimSessionControls } from './host.js';
import { mulberry32 } from './prng.js';

export interface FleetOptions {
  hubId: string;
  /** Same seed → same fleet, same order, same timings. */
  seed?: number;
  /** Time compression: 1 = demo pacing, 20 = E2E pacing. */
  speed?: number;
}

export interface SimContext {
  readonly sessionId: string;
  rng: () => number;
  sleep: (ms: number) => Promise<void>;
  status: (status: SessionStatus, tool?: CurrentTool) => void;
  transcript: (role: 'user' | 'assistant' | 'system', text: string, done?: boolean) => void;
  tool: (phase: 'start' | 'end', name: string, detail: string, ok?: boolean) => void;
  addStats: (delta: { input?: number; output?: number; cost?: number; turns?: number }) => void;
  notice: (level: 'info' | 'warn' | 'error', text: string) => void;
  permission: (tool: {
    name: string;
    input: string;
    diff?: string;
  }) => Promise<PermissionResolution>;
}

export type Scenario = (ctx: SimContext) => Promise<void>;

export interface ScriptedSession {
  session: Omit<Session, 'hubId' | 'statusSince' | 'lastActivity' | 'stats' | 'status'>;
  scenario: Scenario;
}

class StoppedError extends Error {
  constructor() {
    super('simulator stopped');
  }
}

interface SessionRuntime {
  abort: AbortController;
  stats: SessionStats;
  startedAt: number;
}

/**
 * Drives a deterministic scripted fleet against a SimHost (SPEC §4.4).
 * Load-bearing: `agentdeck --demo`, Playwright E2E, and the README GIF all
 * run on this.
 */
export class SimulatorFleet {
  private readonly rng: () => number;
  private readonly speed: number;
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly fleetAbort = new AbortController();

  constructor(
    private readonly host: SimHost,
    private readonly scripted: ScriptedSession[],
    private readonly options: FleetOptions,
  ) {
    this.rng = mulberry32(options.seed ?? 1337);
    this.speed = options.speed ?? 1;
  }

  start(): void {
    for (const entry of this.scripted) {
      void this.launch(entry);
    }
  }

  stop(): void {
    this.fleetAbort.abort();
    for (const runtime of this.runtimes.values()) runtime.abort.abort();
  }

  private async launch(entry: ScriptedSession): Promise<void> {
    const id = entry.session.id;
    const runtime: SessionRuntime = {
      abort: new AbortController(),
      stats: { inputTokens: 0, outputTokens: 0, turns: 0, elapsedMs: 0 },
      startedAt: Date.now(),
    };
    if (entry.session.harness === 'claude') runtime.stats.costUsd = 0;
    this.runtimes.set(id, runtime);

    const ctx = this.makeContext(id, runtime);
    const controls: SimSessionControls = {
      prompt: (text) => {
        void this.handlePrompt(ctx, text);
      },
      interrupt: () => {
        this.host.notice(id, 'warn', 'Interrupted from the deck');
        this.host.setStatus(id, 'idle');
      },
      setEffort: (axis, value) => {
        this.host.notice(id, 'info', `Dial: ${axis} set to ${value}`);
        return value;
      },
      kill: () => {
        runtime.abort.abort();
        this.host.remove(id);
      },
    };

    this.host.upsert(
      {
        ...entry.session,
        hubId: this.options.hubId,
        status: 'idle',
        statusSince: Date.now(),
        lastActivity: Date.now(),
        stats: { ...runtime.stats },
      },
      controls,
    );

    try {
      await entry.scenario(ctx);
    } catch (error) {
      if (!(error instanceof StoppedError)) {
        this.host.notice(id, 'error', 'Scenario crashed — this is a simulator bug.');
        this.host.setStatus(id, 'error');
      }
    }
  }

  private async handlePrompt(ctx: SimContext, text: string): Promise<void> {
    this.host.transcript(ctx.sessionId, 'user', text, true);
    this.host.setStatus(ctx.sessionId, 'thinking');
    try {
      await ctx.sleep(1200);
    } catch {
      return;
    }
    ctx.addStats({ input: 180, output: 40, turns: 1, cost: 0.002 });
    this.host.transcript(
      ctx.sessionId,
      'assistant',
      'Picking that up after the current step.',
      true,
    );
    this.host.setStatus(ctx.sessionId, 'working');
  }

  private makeContext(id: string, runtime: SessionRuntime): SimContext {
    const jitter = (): number => 0.85 + this.rng() * 0.3;
    return {
      sessionId: id,
      rng: this.rng,
      sleep: (ms) =>
        new Promise((resolve, reject) => {
          if (runtime.abort.signal.aborted || this.fleetAbort.signal.aborted) {
            reject(new StoppedError());
            return;
          }
          const timer = setTimeout(resolve, (ms * jitter()) / this.speed);
          const onAbort = (): void => {
            clearTimeout(timer);
            reject(new StoppedError());
          };
          runtime.abort.signal.addEventListener('abort', onAbort, { once: true });
          this.fleetAbort.signal.addEventListener('abort', onAbort, { once: true });
        }),
      status: (status, tool) => this.host.setStatus(id, status, tool),
      transcript: (role, text, done = true) => this.host.transcript(id, role, text, done),
      tool: (phase, name, detail, ok) => this.host.tool(id, phase, { name, detail }, ok),
      addStats: (delta) => {
        runtime.stats.inputTokens += delta.input ?? 0;
        runtime.stats.outputTokens += delta.output ?? 0;
        runtime.stats.turns += delta.turns ?? 0;
        if (runtime.stats.costUsd !== undefined && delta.cost !== undefined) {
          runtime.stats.costUsd = Math.round((runtime.stats.costUsd + delta.cost) * 10000) / 10000;
        }
        runtime.stats.elapsedMs = Math.round((Date.now() - runtime.startedAt) * this.speed);
        this.host.stats(id, { ...runtime.stats });
      },
      notice: (level, text) => this.host.notice(id, level, text),
      permission: (tool) => this.host.requestPermission(id, tool),
    };
  }
}
