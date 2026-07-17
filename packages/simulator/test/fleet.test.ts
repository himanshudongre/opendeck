import type { PermissionResolution, Session } from '@opendeck/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SimulatorFleet,
  demoFleet,
  mulberry32,
  type SimHost,
  type SimSessionControls,
} from '../src/index.js';

interface PendingPermission {
  sessionId: string;
  tool: { name: string; input: string; diff?: string };
  resolve: (resolution: PermissionResolution) => void;
}

class LogHost implements SimHost {
  log: string[] = [];
  controls = new Map<string, SimSessionControls>();
  permissions: PendingPermission[] = [];

  upsert(session: Session, controls: SimSessionControls): void {
    this.controls.set(session.id, controls);
    this.log.push(`upsert:${session.id}:${session.harness}`);
  }
  setStatus(sessionId: string, status: string): void {
    this.log.push(`status:${sessionId}:${status}`);
  }
  transcript(sessionId: string, role: string, text: string): void {
    this.log.push(`transcript:${sessionId}:${role}:${text.slice(0, 24)}`);
  }
  tool(sessionId: string, phase: string, tool: { name: string; detail: string }): void {
    this.log.push(`tool:${sessionId}:${phase}:${tool.name}`);
  }
  stats(sessionId: string, stats: { inputTokens: number }): void {
    this.log.push(`stats:${sessionId}:${stats.inputTokens}`);
  }
  notice(sessionId: string, level: string, text: string): void {
    this.log.push(`notice:${sessionId}:${level}:${text.slice(0, 24)}`);
  }
  requestPermission(
    sessionId: string,
    tool: { name: string; input: string; diff?: string },
  ): Promise<PermissionResolution> {
    this.log.push(`permission:${sessionId}:${tool.name}`);
    return new Promise((resolve) => {
      this.permissions.push({ sessionId, tool, resolve });
    });
  }
  remove(sessionId: string): void {
    this.log.push(`remove:${sessionId}`);
  }
}

async function runFleet(
  seed: number,
  durationMs: number,
  interact?: (host: LogHost) => void | Promise<void>,
): Promise<LogHost> {
  const host = new LogHost();
  const fleet = new SimulatorFleet(host, demoFleet(), { hubId: 'hub-test', seed, speed: 1 });
  fleet.start();
  await vi.advanceTimersByTimeAsync(durationMs);
  if (interact) {
    await interact(host);
    await vi.advanceTimersByTimeAsync(durationMs);
  }
  fleet.stop();
  await vi.advanceTimersByTimeAsync(1000);
  return host;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SimulatorFleet', () => {
  it('spawns the whole mixed fleet with stable ids', async () => {
    const host = await runFleet(7, 100);
    const upserts = host.log.filter((line) => line.startsWith('upsert:'));
    expect(upserts).toEqual([
      'upsert:sim-auth:claude',
      'upsert:sim-router:codex',
      'upsert:sim-drift:claude',
      'upsert:sim-evals:codex',
      'upsert:sim-docs:simulator',
      'upsert:sim-profile:claude',
      'upsert:sim-invoice:claude',
    ]);
  });

  it('is deterministic: same seed, same event order', async () => {
    const first = await runFleet(42, 30_000);
    vi.setSystemTime(0);
    const second = await runFleet(42, 30_000);
    expect(second.log).toEqual(first.log);
  });

  it('differs across seeds only in timing, never in shape', async () => {
    const first = await runFleet(1, 30_000);
    const second = await runFleet(2, 30_000);
    const shape = (host: LogHost): string[] =>
      host.log.filter((line) => line.startsWith('upsert:') || line.startsWith('permission:'));
    expect(shape(second).sort()).toEqual(shape(first).sort());
  });

  it('raises the auth permission with a unified diff and continues on approve', async () => {
    const host = await runFleet(7, 60_000, (h) => {
      const pending = h.permissions.find((p) => p.sessionId === 'sim-auth');
      expect(pending?.tool.diff).toContain('--- a/src/auth/session.ts');
      pending?.resolve('approve');
    });
    expect(host.log).toContain('status:sim-auth:done');
    expect(host.log.filter((l) => l.startsWith('tool:sim-auth:end:Bash')).length).toBeGreaterThan(
      1,
    );
  });

  it('stops cleanly when a permission is denied', async () => {
    const host = await runFleet(7, 60_000, (h) => {
      for (const pending of h.permissions) pending.resolve('deny');
    });
    expect(host.log).toContain('status:sim-auth:idle');
    expect(host.log).not.toContain('status:sim-auth:done');
  });

  it('plays the error scenario to a red tile', async () => {
    const host = await runFleet(7, 60_000);
    expect(host.log).toContain('status:sim-evals:error');
    expect(host.log.some((l) => l.startsWith('notice:sim-evals:error'))).toBe(true);
  });

  it('keeps the long-runner working indefinitely', async () => {
    const host = await runFleet(7, 120_000);
    const routerEdits = host.log.filter((l) => l.startsWith('tool:sim-router:end:Edit'));
    expect(routerEdits.length).toBeGreaterThan(5);
    expect(host.log).not.toContain('status:sim-router:done');
  });

  it('reaches the waiting_input ask on the redesign session', async () => {
    const host = await runFleet(7, 60_000);
    expect(host.log).toContain('status:sim-profile:waiting_input');
  });

  it('answers deck controls: prompt, interrupt, effort, kill', async () => {
    const host = new LogHost();
    const fleet = new SimulatorFleet(host, demoFleet(), { hubId: 'hub-test', seed: 7, speed: 1 });
    fleet.start();
    await vi.advanceTimersByTimeAsync(500);

    const auth = host.controls.get('sim-auth');
    expect(auth).toBeDefined();
    auth?.prompt('also update the docs');
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.log).toContain('transcript:sim-auth:user:also update the docs');
    expect(host.log).toContain('status:sim-auth:working');

    auth?.interrupt();
    expect(host.log.some((l) => l.startsWith('notice:sim-auth:warn:Interrupted'))).toBe(true);

    expect(auth?.setEffort('thinking', '16k')).toBe('16k');

    auth?.kill();
    expect(host.log).toContain('remove:sim-auth');

    fleet.stop();
    await vi.advanceTimersByTimeAsync(1000);
  });
});

describe('custom scenarios and edge branches', () => {
  const baseSession = {
    id: 'sim-custom',
    harness: 'codex' as const,
    mode: 'managed' as const,
    title: 'edge case probe',
    cwd: '/tmp',
    capabilities: [],
  };

  it('marks a crashing scenario as an error tile', async () => {
    const host = new LogHost();
    const fleet = new SimulatorFleet(
      host,
      [
        {
          session: baseSession,
          scenario: () => Promise.reject(new Error('scripted explosion')),
        },
      ],
      { hubId: 'hub-test' },
    );
    fleet.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(host.log).toContain('status:sim-custom:error');
    fleet.stop();
  });

  it('ends sleeps with a stop, and refuses new sleeps after it', async () => {
    const host = new LogHost();
    const order: string[] = [];
    const fleet = new SimulatorFleet(
      host,
      [
        {
          session: baseSession,
          scenario: async (ctx) => {
            order.push('started');
            await ctx.sleep(60_000);
            order.push('unreachable');
          },
        },
      ],
      { hubId: 'hub-test' },
    );
    fleet.start();
    await vi.advanceTimersByTimeAsync(10);
    fleet.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(order).toEqual(['started']);
    expect(host.log).not.toContain('status:sim-custom:error');
  });

  it('ignores cost deltas for sessions without a cost meter', async () => {
    const host = new LogHost();
    const fleet = new SimulatorFleet(
      host,
      [
        {
          session: baseSession,
          scenario: (ctx) => {
            ctx.addStats({ input: 10, cost: 0.5 });
            ctx.tool('start', 'Bash', 'ls');
            return Promise.resolve();
          },
        },
      ],
      { hubId: 'hub-test' },
    );
    fleet.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(host.log).toContain('stats:sim-custom:10');
    fleet.stop();
  });

  it('lets a prompt arriving mid-stop fail quietly', async () => {
    const host = new LogHost();
    const fleet = new SimulatorFleet(
      host,
      [{ session: baseSession, scenario: (ctx) => ctx.sleep(60_000) }],
      { hubId: 'hub-test' },
    );
    fleet.start();
    await vi.advanceTimersByTimeAsync(10);
    fleet.stop();
    host.controls.get('sim-custom')?.prompt('too late');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.log).toContain('transcript:sim-custom:user:too late');
    expect(host.log).not.toContain('status:sim-custom:working');
  });
});

describe('mulberry32', () => {
  it('is reproducible and uniform-ish', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(new Set(seqA).size).toBe(3);
  });
});
