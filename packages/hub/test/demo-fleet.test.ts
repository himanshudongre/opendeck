import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hub } from '../src/core/hub.js';
import { startDemoFleet } from '../src/adapters/simulator.js';
import { tempHome } from './helpers.js';

let restoreHome: () => void;
beforeEach(() => {
  restoreHome = tempHome();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  restoreHome();
});

describe('startDemoFleet', () => {
  it('registers the scripted fleet on the hub with working controllers', async () => {
    const hub = new Hub({ version: '1.0.0-test' });
    const fleet = startDemoFleet(hub, { seed: 7, speed: 1 });
    await vi.advanceTimersByTimeAsync(500);

    const sessions = hub.snapshot();
    expect(sessions).toHaveLength(7);
    expect(new Set(sessions.map((s) => s.harness))).toEqual(
      new Set(['claude', 'codex', 'simulator']),
    );

    // The deck can drive a simulated session end to end through the hub.
    const prompt = await hub.dispatch({
      v: 1,
      id: 'c-1',
      type: 'prompt',
      payload: { sessionId: 'sim-auth', text: 'run the whole suite' },
    });
    expect(prompt).toEqual({ ok: true });

    const effort = await hub.dispatch({
      v: 1,
      id: 'c-2',
      type: 'set_effort',
      payload: { sessionId: 'sim-auth', axis: 'thinking', value: '32k' },
    });
    expect(effort).toEqual({ ok: true, data: { axis: 'thinking', value: '32k' } });

    // Scripted permission requests surface as real hub permission requests.
    await vi.advanceTimersByTimeAsync(20_000);
    const waiting = hub.pendingPermissionsFor('sim-auth');
    expect(waiting.length + hub.pendingPermissionsFor('sim-invoice').length).toBeGreaterThan(0);

    const interrupt = await hub.dispatch({
      v: 1,
      id: 'c-int',
      type: 'action',
      payload: { sessionId: 'sim-router', kind: 'interrupt' },
    });
    expect(interrupt).toEqual({ ok: true });

    const kill = await hub.dispatch({
      v: 1,
      id: 'c-3',
      type: 'action',
      payload: { sessionId: 'sim-docs', kind: 'kill' },
    });
    expect(kill).toEqual({ ok: true });
    expect(hub.snapshot().find((s) => s.id === 'sim-docs')).toBeUndefined();

    fleet.stop();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('starts with default pacing when no options are given', async () => {
    const hub = new Hub({ version: '1.0.0-test' });
    const fleet = startDemoFleet(hub);
    await vi.advanceTimersByTimeAsync(100);
    expect(hub.snapshot()).toHaveLength(7);
    fleet.stop();
    await vi.advanceTimersByTimeAsync(1000);
  });
});
