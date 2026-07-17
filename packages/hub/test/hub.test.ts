import type { ServerMsg } from '@opendeck/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hub } from '../src/core/hub.js';
import { SessionRegistry } from '../src/core/session-registry.js';
import { makeSession } from './helpers.js';

describe('SessionRegistry', () => {
  it('registers, patches, lists, and removes sessions', () => {
    const registry = new SessionRegistry();
    const controller = { prompt: vi.fn() };
    registry.register(makeSession(), controller);

    expect(registry.get('sess-1')?.title).toBe('refactor payment retries');
    expect(registry.controller('sess-1')).toBe(controller);
    expect(registry.size()).toBe(1);

    const patched = registry.patch('sess-1', { status: 'done' });
    expect(patched?.status).toBe('done');
    expect(registry.patch('missing', { status: 'done' })).toBeUndefined();

    expect(registry.list()).toHaveLength(1);
    expect(registry.remove('sess-1')).toBe(true);
    expect(registry.remove('sess-1')).toBe(false);
    expect(registry.get('sess-1')).toBeUndefined();
  });
});

describe('Hub', () => {
  let hub: Hub;
  let sent: ServerMsg[];

  beforeEach(() => {
    hub = new Hub({ version: '1.0.0-test', now: () => 42 });
    sent = [];
    hub.bus.on('broadcast', (msg) => sent.push(msg));
  });

  it('broadcasts upserts with monotonically increasing seq', () => {
    hub.upsertSession(makeSession(), {});
    hub.upsertSession(makeSession({ id: 'sess-2' }), {});
    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
    expect(sent.every((m) => m.type === 'session_upsert')).toBe(true);
    expect(hub.snapshot()).toHaveLength(2);
    expect(hub.currentSeq()).toBe(2);
  });

  it('emits status events and keeps the stored session in sync', () => {
    hub.upsertSession(makeSession(), {});
    hub.setStatus('sess-1', 'thinking');
    const statusMsg = sent.at(-1);
    expect(statusMsg?.type).toBe('event');
    if (statusMsg?.type === 'event' && statusMsg.payload.kind === 'status') {
      expect(statusMsg.payload.status).toBe('thinking');
      expect(statusMsg.payload.statusSince).toBe(42);
    }
    expect(hub.snapshot()[0]?.status).toBe('thinking');
  });

  it('ignores events for unknown sessions', () => {
    hub.setStatus('ghost', 'working');
    hub.transcript('ghost', 'assistant', 'hi', true);
    hub.notice('ghost', 'info', 'hi');
    hub.toolEvent('ghost', 'start', { name: 'Bash', detail: 'ls' });
    hub.updateStats('ghost', { inputTokens: 1, outputTokens: 1, turns: 1, elapsedMs: 1 });
    expect(sent).toHaveLength(0);
  });

  it('replays events after a given seq', () => {
    hub.upsertSession(makeSession(), {});
    hub.setStatus('sess-1', 'working');
    hub.notice('sess-1', 'info', 'started');
    const replay = hub.replaySince(1);
    expect(replay?.map((m) => m.seq)).toEqual([2, 3]);
  });

  it('runs the full permission round-trip from the deck', async () => {
    hub.upsertSession(makeSession(), {});
    const { id, resolution } = hub.requestPermission('sess-1', {
      name: 'Edit',
      input: 'src/pay.ts',
      diff: '--- a\n+++ b\n',
    });

    expect(hub.snapshot()[0]?.status).toBe('waiting_permission');
    expect(hub.pendingPermissionsFor('sess-1')).toHaveLength(1);

    const result = await hub.dispatch({
      v: 1,
      id: 'c-1',
      type: 'permission_response',
      payload: { requestId: id, resolution: 'always_allow' },
    });
    expect(result).toEqual({ ok: true });
    await expect(resolution).resolves.toBe('always_allow');

    const resolved = sent.at(-1);
    expect(resolved?.type).toBe('permission_resolved');
    if (resolved?.type === 'permission_resolved') {
      expect(resolved.payload).toEqual({
        requestId: id,
        sessionId: 'sess-1',
        outcome: 'always_allow',
        source: 'deck',
      });
    }
    expect(hub.pendingPermissionsFor('sess-1')).toHaveLength(0);
  });

  it('lets approve/deny actions answer the oldest pending request', async () => {
    hub.upsertSession(makeSession(), {});
    const { resolution } = hub.requestPermission('sess-1', { name: 'Bash', input: 'pnpm test' });
    const result = await hub.dispatch({
      v: 1,
      id: 'c-2',
      type: 'action',
      payload: { sessionId: 'sess-1', kind: 'approve' },
    });
    expect(result).toEqual({ ok: true });
    await expect(resolution).resolves.toBe('approve');
  });

  it('resolves from the harness side and rejects stale deck answers', async () => {
    hub.upsertSession(makeSession(), {});
    const { id, resolution } = hub.requestPermission('sess-1', { name: 'Bash', input: 'ls' });
    hub.resolvePermissionFromHarness(id, 'deny');
    await expect(resolution).resolves.toBe('deny');

    const stale = await hub.dispatch({
      v: 1,
      id: 'c-3',
      type: 'permission_response',
      payload: { requestId: id, resolution: 'approve' },
    });
    expect(stale.ok).toBe(false);
  });

  it('dismisses pending permissions when the session is removed', () => {
    hub.upsertSession(makeSession(), {});
    hub.requestPermission('sess-1', { name: 'Bash', input: 'ls' });
    hub.removeSession('sess-1');

    const types = sent.map((m) => m.type);
    expect(types).toContain('permission_resolved');
    expect(types.at(-1)).toBe('session_removed');
    const resolved = sent.find((m) => m.type === 'permission_resolved');
    if (resolved?.type === 'permission_resolved') {
      expect(resolved.payload.outcome).toBe('dismissed');
    }
  });

  it('routes prompt and set_effort to the controller with reconciliation', async () => {
    const controller = {
      prompt: vi.fn(),
      setEffort: vi.fn().mockReturnValue('high'),
    };
    hub.upsertSession(makeSession(), controller);

    const promptResult = await hub.dispatch({
      v: 1,
      id: 'c-4',
      type: 'prompt',
      payload: { sessionId: 'sess-1', text: 'run tests' },
    });
    expect(promptResult).toEqual({ ok: true });
    expect(controller.prompt).toHaveBeenCalledWith('run tests');

    const effortResult = await hub.dispatch({
      v: 1,
      id: 'c-5',
      type: 'set_effort',
      payload: { sessionId: 'sess-1', axis: 'effort', value: 'high' },
    });
    expect(effortResult).toEqual({ ok: true, data: { axis: 'effort', value: 'high' } });
  });

  it('rejects controller calls the adapter did not wire', async () => {
    hub.upsertSession(makeSession(), {});
    const result = await hub.dispatch({
      v: 1,
      id: 'c-6',
      type: 'prompt',
      payload: { sessionId: 'sess-1', text: 'hello' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported');
  });

  it('rejects messages for unknown sessions', async () => {
    const result = await hub.dispatch({
      v: 1,
      id: 'c-7',
      type: 'prompt',
      payload: { sessionId: 'ghost', text: 'hello' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unknown_session');
  });

  it('routes interrupt/kill/resume actions and prompt_template text', async () => {
    const controller = {
      interrupt: vi.fn(),
      kill: vi.fn(),
      resume: vi.fn(),
      prompt: vi.fn(),
    };
    hub.upsertSession(makeSession(), controller);

    for (const kind of ['interrupt', 'kill', 'resume'] as const) {
      const result = await hub.dispatch({
        v: 1,
        id: `c-${kind}`,
        type: 'action',
        payload: { sessionId: 'sess-1', kind },
      });
      expect(result).toEqual({ ok: true });
    }
    expect(controller.interrupt).toHaveBeenCalledOnce();
    expect(controller.kill).toHaveBeenCalledOnce();
    expect(controller.resume).toHaveBeenCalledOnce();

    const template = await hub.dispatch({
      v: 1,
      id: 'c-8',
      type: 'action',
      payload: { sessionId: 'sess-1', kind: 'prompt_template', args: { text: 'fix the tests' } },
    });
    expect(template).toEqual({ ok: true });
    expect(controller.prompt).toHaveBeenCalledWith('fix the tests');

    const missingText = await hub.dispatch({
      v: 1,
      id: 'c-9',
      type: 'action',
      payload: { sessionId: 'sess-1', kind: 'prompt_template' },
    });
    expect(missingText.ok).toBe(false);
  });

  it('gates shell actions on config presence and an explicit confirm', async () => {
    const runShell = vi.fn().mockResolvedValue({ ok: true, output: 'done' });
    const shellHub = new Hub({
      version: '1.0.0-test',
      customActions: [{ id: 'deploy', label: 'Deploy preview', command: 'echo deploy' }],
      runShell,
    });
    shellHub.upsertSession(makeSession(), {});

    const notInConfig = await shellHub.dispatch({
      v: 1,
      id: 'c-10',
      type: 'action',
      payload: { kind: 'shell', args: { actionId: 'rm-rf', confirmed: true } },
    });
    expect(notInConfig.ok).toBe(false);
    if (!notInConfig.ok) expect(notInConfig.code).toBe('unsupported');

    const unconfirmed = await shellHub.dispatch({
      v: 1,
      id: 'c-11',
      type: 'action',
      payload: { kind: 'shell', args: { actionId: 'deploy' } },
    });
    expect(unconfirmed.ok).toBe(false);
    expect(runShell).not.toHaveBeenCalled();

    const confirmed = await shellHub.dispatch({
      v: 1,
      id: 'c-12',
      type: 'action',
      payload: {
        sessionId: 'sess-1',
        kind: 'shell',
        args: { actionId: 'deploy', confirmed: true },
      },
    });
    expect(confirmed.ok).toBe(true);
    expect(runShell).toHaveBeenCalledOnce();
  });

  it('rejects connection-scoped messages at the dispatch layer', async () => {
    const result = await hub.dispatch({
      v: 1,
      id: 'c-13',
      type: 'ping',
      payload: { t: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_message');
  });
});
