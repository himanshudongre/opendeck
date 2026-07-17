import { describe, expect, it, vi } from 'vitest';
import {
  CODEX_EFFORT_DETENTS,
  CODEX_SANDBOX_PRESETS,
  CodexAdapter,
  type CodexRunner,
  type CodexTurnHandle,
} from '../src/adapters/codex/exec.js';
import {
  loadFixtureLines,
  observedHub,
  runAdapterContract,
  type ContractObservations,
} from './adapter-contract.js';

interface RunnerLog {
  calls: { args: string[]; cwd: string }[];
  killed: boolean;
}

function fixtureRunner(lines: string[], log: RunnerLog, exitCode = 0): CodexRunner {
  return (args, cwd): CodexTurnHandle => {
    log.calls.push({ args, cwd });
    return {
      lines: (async function* () {
        await Promise.resolve();
        for (const line of lines) yield line;
      })(),
      kill: () => {
        log.killed = true;
      },
      done: Promise.resolve({ exitCode }),
    };
  };
}

async function play(fixture: string): Promise<ContractObservations & { log: RunnerLog }> {
  const { hub, events } = observedHub();
  const log: RunnerLog = { calls: [], killed: false };
  const adapter = new CodexAdapter(hub, {
    runner: fixtureRunner(loadFixtureLines(fixture), log),
  });
  const { sessionId } = await adapter.spawn({
    cwd: '/home/dev/acme/storefront',
    prompt: 'fix the checkout retry test',
  });
  await vi.waitFor(() => {
    const settled = events.some(
      (msg) =>
        msg.type === 'event' &&
        msg.payload.kind === 'status' &&
        (msg.payload.status === 'done' || msg.payload.status === 'error'),
    );
    expect(settled).toBe(true);
  });
  const session = hub.snapshot().find((entry) => entry.id === sessionId);
  if (!session) throw new Error('session vanished');
  return { session, events, log };
}

runAdapterContract({
  name: 'codex managed (exec --json)',
  playHappyPath: () => play('codex-exec.jsonl'),
  playError: () => play('codex-error.jsonl'),
  resume: async () => {
    const { hub, events } = observedHub();
    const log: RunnerLog = { calls: [], killed: false };
    const adapter = new CodexAdapter(hub, {
      runner: fixtureRunner(loadFixtureLines('codex-exec.jsonl'), log),
    });
    const { sessionId } = await adapter.spawn({
      cwd: '/home/dev/acme/storefront',
      prompt: 'first turn',
    });
    await vi.waitFor(() => {
      expect(
        events.some(
          (msg) =>
            msg.type === 'event' && msg.payload.kind === 'status' && msg.payload.status === 'done',
        ),
      ).toBe(true);
    });

    // The fixture's thread.started id must be reused for the next turn.
    await hub.dispatch({
      v: 1,
      id: 'c-next',
      type: 'prompt',
      payload: { sessionId, text: 'now add a regression test' },
    });
    const second = log.calls[1];
    return {
      usedNativeId:
        second !== undefined &&
        second.args.includes('resume') &&
        second.args.includes('0199a213-81c0-7800-8000-1f6cd6a9a733'),
    };
  },
});

describe('codex specifics', () => {
  it('builds exec args with sandbox and reasoning effort', async () => {
    const obs = await play('codex-exec.jsonl');
    const first = obs.log.calls[0];
    expect(first?.args[0]).toBe('exec');
    expect(first?.args).toContain('--json');
    expect(first?.args).toContain('--sandbox');
    expect(first?.args.join(' ')).toContain('model_reasoning_effort=medium');
    expect(first?.args.at(-1)).toBe('fix the checkout retry test');
    expect(first?.cwd).toBe('/home/dev/acme/storefront');
  });

  it('applies the reasoning dial to the next turn', async () => {
    const { hub, events } = observedHub();
    const log: RunnerLog = { calls: [], killed: false };
    const adapter = new CodexAdapter(hub, {
      runner: fixtureRunner(loadFixtureLines('codex-exec.jsonl'), log),
    });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev', prompt: 'go' });
    await vi.waitFor(() => {
      expect(
        events.some(
          (m) => m.type === 'event' && m.payload.kind === 'status' && m.payload.status === 'done',
        ),
      ).toBe(true);
    });

    const effort = await hub.dispatch({
      v: 1,
      id: 'c-e',
      type: 'set_effort',
      payload: { sessionId, axis: 'effort', value: 'high' },
    });
    expect(effort).toEqual({ ok: true, data: { axis: 'effort', value: 'high' } });

    const invalid = await hub.dispatch({
      v: 1,
      id: 'c-e2',
      type: 'set_effort',
      payload: { sessionId, axis: 'effort', value: 'ultra' },
    });
    expect(invalid.ok).toBe(false);

    await hub.dispatch({
      v: 1,
      id: 'c-p',
      type: 'prompt',
      payload: { sessionId, text: 'harder' },
    });
    expect(log.calls[1]?.args.join(' ')).toContain('model_reasoning_effort=high');
    expect(CODEX_EFFORT_DETENTS).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
  });

  it('selects sandbox presets through the custom action', async () => {
    const { hub } = observedHub();
    const log: RunnerLog = { calls: [], killed: false };
    const adapter = new CodexAdapter(hub, {
      runner: fixtureRunner(loadFixtureLines('codex-exec.jsonl'), log),
    });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev' });

    const preset = await hub.dispatch({
      v: 1,
      id: 'c-s',
      type: 'action',
      payload: { sessionId, kind: 'custom', args: { sandbox: 'read-only' } },
    });
    expect(preset).toEqual({ ok: true });

    await hub.dispatch({
      v: 1,
      id: 'c-p2',
      type: 'prompt',
      payload: { sessionId, text: 'inspect only' },
    });
    const call = log.calls[0];
    expect(call?.args.join(' ')).toContain('--sandbox read-only');
    expect(CODEX_SANDBOX_PRESETS).toContain('read-only');
  });

  it('refuses overlapping turns instead of corrupting the stream', async () => {
    const { hub, events } = observedHub();
    const log: RunnerLog = { calls: [], killed: false };
    // A turn that never finishes.
    const runner: CodexRunner = (args, cwd) => {
      log.calls.push({ args, cwd });
      return {
        lines: (async function* () {
          yield '{"type":"turn.started"}';
          await new Promise(() => undefined);
        })(),
        kill: () => {
          log.killed = true;
        },
        done: new Promise(() => undefined),
      };
    };
    const adapter = new CodexAdapter(hub, { runner });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev', prompt: 'long task' });

    await hub.dispatch({
      v: 1,
      id: 'c-p3',
      type: 'prompt',
      payload: { sessionId, text: 'second task' },
    });
    expect(log.calls).toHaveLength(1);
    expect(
      events.some(
        (m) =>
          m.type === 'event' &&
          m.payload.kind === 'notice' &&
          m.payload.text.includes('already running'),
      ),
    ).toBe(true);

    const interrupt = await hub.dispatch({
      v: 1,
      id: 'c-i',
      type: 'action',
      payload: { sessionId, kind: 'interrupt' },
    });
    expect(interrupt.ok).toBe(true);
    expect(log.killed).toBe(true);
  });

  it('marks a non-zero exec exit as an error', async () => {
    const { hub, events } = observedHub();
    const log: RunnerLog = { calls: [], killed: false };
    const adapter = new CodexAdapter(hub, {
      runner: fixtureRunner(['{"type":"turn.started"}'], log, 2),
    });
    await adapter.spawn({ cwd: '/home/dev', prompt: 'boom' });
    await vi.waitFor(() => {
      expect(
        events.some(
          (m) => m.type === 'event' && m.payload.kind === 'status' && m.payload.status === 'error',
        ),
      ).toBe(true);
    });
  });

  it('rejects resume before a thread exists, then resumes after one', async () => {
    const { hub, events } = observedHub();
    const log: RunnerLog = { calls: [], killed: false };
    const adapter = new CodexAdapter(hub, {
      runner: fixtureRunner(loadFixtureLines('codex-exec.jsonl'), log),
    });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev' });

    const early = await hub.dispatch({
      v: 1,
      id: 'c-r0',
      type: 'action',
      payload: { sessionId, kind: 'resume' },
    });
    expect(early.ok).toBe(false);

    await hub.dispatch({ v: 1, id: 'c-p', type: 'prompt', payload: { sessionId, text: 'go' } });
    await vi.waitFor(() => {
      expect(
        events.some(
          (m) => m.type === 'event' && m.payload.kind === 'status' && m.payload.status === 'done',
        ),
      ).toBe(true);
    });

    const resume = await hub.dispatch({
      v: 1,
      id: 'c-r1',
      type: 'action',
      payload: { sessionId, kind: 'resume' },
    });
    expect(resume.ok).toBe(true);
    expect(log.calls[1]?.args).toContain('resume');
  });

  it('rejects unknown sandbox presets and non-sandbox custom actions', async () => {
    const { hub } = observedHub();
    const log: RunnerLog = { calls: [], killed: false };
    const adapter = new CodexAdapter(hub, {
      runner: fixtureRunner(loadFixtureLines('codex-exec.jsonl'), log),
    });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev' });

    const badPreset = await hub.dispatch({
      v: 1,
      id: 'c-b1',
      type: 'action',
      payload: { sessionId, kind: 'custom', args: { sandbox: 'yolo' } },
    });
    expect(badPreset.ok).toBe(false);

    const compact = await hub.dispatch({
      v: 1,
      id: 'c-b2',
      type: 'action',
      payload: { sessionId, kind: 'compact' },
    });
    expect(compact.ok).toBe(false);

    const wrongAxis = await hub.dispatch({
      v: 1,
      id: 'c-b3',
      type: 'set_effort',
      payload: { sessionId, axis: 'model', value: 'opus' },
    });
    expect(wrongAxis.ok).toBe(false);
  });

  it('passes the model through to exec config', async () => {
    const { hub } = observedHub();
    const log: RunnerLog = { calls: [], killed: false };
    const adapter = new CodexAdapter(hub, {
      runner: fixtureRunner(loadFixtureLines('codex-exec.jsonl'), log),
    });
    await adapter.spawn({ cwd: '/home/dev', prompt: 'go', model: 'gpt-5.2-codex' });
    expect(log.calls[0]?.args.join(' ')).toContain('model=gpt-5.2-codex');
  });

  it('marks a crashed stream as an error and removes killed sessions quietly', async () => {
    const { hub, events } = observedHub();
    const crashingRunner: CodexRunner = () => ({
      lines: (async function* (): AsyncGenerator<string> {
        await Promise.resolve();
        throw new Error('pipe burst');
      })(),
      kill: () => undefined,
      done: Promise.resolve({ exitCode: undefined }),
    });
    const adapter = new CodexAdapter(hub, { runner: crashingRunner });
    await adapter.spawn({ cwd: '/home/dev', prompt: 'go' });
    await vi.waitFor(() => {
      expect(
        events.some(
          (m) => m.type === 'event' && m.payload.kind === 'status' && m.payload.status === 'error',
        ),
      ).toBe(true);
    });

    const log: RunnerLog = { calls: [], killed: false };
    const adapter2 = new CodexAdapter(hub, {
      runner: fixtureRunner(loadFixtureLines('codex-exec.jsonl'), log),
    });
    const { sessionId } = await adapter2.spawn({ cwd: '/home/dev' });
    const kill = await hub.dispatch({
      v: 1,
      id: 'c-k',
      type: 'action',
      payload: { sessionId, kind: 'kill' },
    });
    expect(kill.ok).toBe(true);
    expect(hub.snapshot().find((s) => s.id === sessionId)).toBeUndefined();
    await adapter2.dispose();
    await adapter2.attachObservers();
  });

  it('reports detect() honestly on machines without codex', async () => {
    const { hub } = observedHub();
    const adapter = new CodexAdapter(hub);
    const result = await adapter.detect();
    if (result.installed) {
      expect(result.version).toBeDefined();
    } else {
      expect(result.note).toBe('Codex not installed');
    }
  });
});
