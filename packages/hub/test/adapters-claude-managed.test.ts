import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_MODEL_DETENTS,
  CLAUDE_THINKING_DETENTS,
  ClaudeManagedAdapter,
  type QueryFn,
} from '../src/adapters/claude/managed.js';
import {
  loadFixtureLines,
  observedHub,
  runAdapterContract,
  type ContractObservations,
} from './adapter-contract.js';

interface Captured {
  options: Options | undefined;
  interrupted: boolean;
  model: string | undefined;
  thinking: number | null | undefined;
}

function fixtureMessages(name: string): SDKMessage[] {
  return loadFixtureLines(name).map((line) => JSON.parse(line) as SDKMessage);
}

function fakeQueryFn(messages: SDKMessage[], captured: Captured): QueryFn {
  return ({ options }) => {
    captured.options = options;
    const generator = (async function* () {
      await Promise.resolve();
      for (const msg of messages) yield msg;
    })();
    return Object.assign(generator, {
      interrupt: () => {
        captured.interrupted = true;
        return Promise.resolve(undefined);
      },
      setModel: (model?: string) => {
        captured.model = model;
        return Promise.resolve();
      },
      setMaxThinkingTokens: (tokens: number | null) => {
        captured.thinking = tokens;
        return Promise.resolve();
      },
    }) as unknown as Query;
  };
}

function newCaptured(): Captured {
  return { options: undefined, interrupted: false, model: undefined, thinking: undefined };
}

async function play(fixture: string): Promise<ContractObservations & { captured: Captured }> {
  const { hub, events } = observedHub();
  const captured = newCaptured();
  const adapter = new ClaudeManagedAdapter(hub, {
    queryFn: fakeQueryFn(fixtureMessages(fixture), captured),
  });
  const { sessionId } = await adapter.spawn({ cwd: '/home/dev/acme/api', prompt: 'fix the flake' });
  await vi.waitFor(() => {
    const done = events.some(
      (msg) =>
        msg.type === 'event' &&
        msg.payload.kind === 'status' &&
        (msg.payload.status === 'done' || msg.payload.status === 'error'),
    );
    expect(done).toBe(true);
  });
  const session = hub.snapshot().find((entry) => entry.id === sessionId);
  if (!session) throw new Error('session vanished');
  return { session, events, captured };
}

async function triggerPermission(respond: 'approve' | 'deny' | 'always_allow'): Promise<{
  behavior: string;
  updatedPermissions?: unknown;
  events: ReturnType<typeof observedHub>['events'];
}> {
  const { hub, events } = observedHub();
  const captured = newCaptured();
  const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], captured) });
  const { sessionId } = await adapter.spawn({ cwd: '/home/dev/acme/api' });

  const canUseTool = captured.options?.canUseTool;
  if (!canUseTool) throw new Error('canUseTool was not wired into query options');
  const decision = canUseTool(
    'Edit',
    { file_path: '/home/dev/acme/api/src/a.ts', old_string: 'a', new_string: 'b' },
    {
      signal: new AbortController().signal,
      toolUseID: 'toolu_test',
      requestId: 'req_test',
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Edit' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    },
  );

  await vi.waitFor(() => {
    expect(hub.pendingPermissionsFor(sessionId).length).toBe(1);
  });
  const pending = hub.pendingPermissionsFor(sessionId)[0];
  if (!pending) throw new Error('no pending permission');
  expect(pending.tool.diff).toContain('-a');
  expect(pending.tool.diff).toContain('+b');

  await hub.dispatch({
    v: 1,
    id: 'c-perm',
    type: 'permission_response',
    payload: { requestId: pending.id, resolution: respond },
  });
  const result = await decision;
  if (result === null) throw new Error('canUseTool returned null');
  return {
    behavior: result.behavior,
    ...(result.behavior === 'allow' && result.updatedPermissions !== undefined
      ? { updatedPermissions: result.updatedPermissions }
      : {}),
    events,
  };
}

runAdapterContract({
  name: 'claude managed (Agent SDK)',
  playHappyPath: () => play('claude-stream.jsonl'),
  playError: () => play('claude-error.jsonl'),
  permission: {
    approve: async () => {
      const result = await triggerPermission('approve');
      return { adapterSawAllow: result.behavior === 'allow', events: result.events };
    },
    deny: async () => {
      const result = await triggerPermission('deny');
      return { adapterSawDeny: result.behavior === 'deny' };
    },
  },
  resume: async () => {
    const { hub } = observedHub();
    const captured = newCaptured();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], captured) });
    await adapter.spawn({ cwd: '/home/dev/acme/api', resumeSessionId: 'native-abc-123' });
    return { usedNativeId: captured.options?.resume === 'native-abc-123' };
  },
});

describe('claude managed specifics', () => {
  it('always_allow forwards the CLI permission suggestions', async () => {
    const result = await triggerPermission('always_allow');
    expect(result.behavior).toBe('allow');
    expect(result.updatedPermissions).toBeDefined();
  });

  it('maps the dial axes onto setModel and setMaxThinkingTokens', async () => {
    const { hub } = observedHub();
    const captured = newCaptured();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], captured) });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev' });

    const modelResult = await hub.dispatch({
      v: 1,
      id: 'c-m',
      type: 'set_effort',
      payload: { sessionId, axis: 'model', value: 'opus' },
    });
    expect(modelResult.ok).toBe(true);
    expect(captured.model).toBe('opus');

    const thinkingResult = await hub.dispatch({
      v: 1,
      id: 'c-t',
      type: 'set_effort',
      payload: { sessionId, axis: 'thinking', value: '16k' },
    });
    expect(thinkingResult.ok).toBe(true);
    expect(captured.thinking).toBe(16_384);

    const badTier = await hub.dispatch({
      v: 1,
      id: 'c-b',
      type: 'set_effort',
      payload: { sessionId, axis: 'model', value: 'gpt-4' },
    });
    expect(badTier.ok).toBe(false);

    expect(CLAUDE_MODEL_DETENTS).toEqual(['haiku', 'sonnet', 'opus']);
    expect(Object.keys(CLAUDE_THINKING_DETENTS)).toEqual(['off', '4k', '16k', '32k']);
  });

  it('titles sessions from the prompt, or the directory when idle', async () => {
    const { hub } = observedHub();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], newCaptured()) });
    await adapter.spawn({ cwd: '/home/dev/acme/api' });
    expect(hub.snapshot()[0]?.title).toBe('api');

    const longPrompt = `${'refactor the entire payment pipeline and'.repeat(3)} more`;
    await adapter.spawn({ cwd: '/home/dev/acme/api', prompt: longPrompt });
    const titled = hub.snapshot().find((s) => s.title.endsWith('…'));
    expect(titled?.title.length).toBeLessThanOrEqual(60);
  });

  it('interrupts through the SDK and idles the tile', async () => {
    const { hub } = observedHub();
    const captured = newCaptured();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], captured) });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev' });
    const result = await hub.dispatch({
      v: 1,
      id: 'c-int',
      type: 'action',
      payload: { sessionId, kind: 'interrupt' },
    });
    expect(result.ok).toBe(true);
    expect(captured.interrupted).toBe(true);
    expect(hub.snapshot()[0]?.status).toBe('idle');
  });

  it('rejects the codex-only effort axis and unknown thinking detents', async () => {
    const { hub } = observedHub();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], newCaptured()) });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev' });

    const effortAxis = await hub.dispatch({
      v: 1,
      id: 'c-ea',
      type: 'set_effort',
      payload: { sessionId, axis: 'effort', value: 'high' },
    });
    expect(effortAxis.ok).toBe(false);

    const badThinking = await hub.dispatch({
      v: 1,
      id: 'c-bt',
      type: 'set_effort',
      payload: { sessionId, axis: 'thinking', value: '64k' },
    });
    expect(badThinking.ok).toBe(false);
  });

  it('marks a crashed SDK stream as an error tile', async () => {
    const { hub, events } = observedHub();
    const captured = newCaptured();
    const crashingQuery: QueryFn = (params) => {
      captured.options = params.options;
      const generator = (async function* (): AsyncGenerator<SDKMessage> {
        await Promise.resolve();
        throw new Error('bridge died');
      })();
      return generator as unknown as Query;
    };
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: crashingQuery });
    await adapter.spawn({ cwd: '/home/dev' });
    await vi.waitFor(() => {
      expect(
        events.some(
          (m) => m.type === 'event' && m.payload.kind === 'status' && m.payload.status === 'error',
        ),
      ).toBe(true);
    });
  });

  it('announces resumed sessions', async () => {
    const { hub, events } = observedHub();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], newCaptured()) });
    await adapter.spawn({ cwd: '/home/dev', resumeSessionId: 'native-1' });
    expect(
      events.some(
        (m) =>
          m.type === 'event' && m.payload.kind === 'notice' && m.payload.text === 'Session resumed',
      ),
    ).toBe(true);
  });

  it('disposes every live session', async () => {
    const { hub } = observedHub();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], newCaptured()) });
    await adapter.spawn({ cwd: '/home/dev' });
    await adapter.spawn({ cwd: '/home/dev/two' });
    expect(hub.snapshot()).toHaveLength(2);
    await adapter.dispose();
    expect(hub.snapshot()).toHaveLength(0);
    await adapter.attachObservers();
  });

  it('reports installed/not-installed through detect()', async () => {
    const { hub } = observedHub();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], newCaptured()) });
    const result = await adapter.detect();
    // This machine has Claude Code; CI may not. Either answer must be honest.
    if (result.installed) {
      expect(result.version).toMatch(/^\d+\./);
      expect(result.note).toContain('Claude Code');
    } else {
      expect(result.note).toBe('Claude Code not installed');
    }
  });

  it('kills the session and dismisses its pending work', async () => {
    const { hub, events } = observedHub();
    const captured = newCaptured();
    const adapter = new ClaudeManagedAdapter(hub, { queryFn: fakeQueryFn([], captured) });
    const { sessionId } = await adapter.spawn({ cwd: '/home/dev' });

    const kill = await hub.dispatch({
      v: 1,
      id: 'c-k',
      type: 'action',
      payload: { sessionId, kind: 'kill' },
    });
    expect(kill.ok).toBe(true);
    expect(hub.snapshot()).toHaveLength(0);
    expect(events.some((msg) => msg.type === 'session_removed')).toBe(true);
  });
});
