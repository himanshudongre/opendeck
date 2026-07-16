import type { ServerMsg } from '@agentdeck/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';
import { Hub } from '../src/core/hub.js';
import { logger, term } from '../src/logger.js';
import { agentdeckHome } from '../src/paths.js';
import { runShellAction } from '../src/server/shell.js';
import { makeSession, tempHome } from './helpers.js';

describe('Hub edge behavior', () => {
  let hub: Hub;
  let sent: ServerMsg[];

  beforeEach(() => {
    hub = new Hub({ version: '1.0.0-test', now: () => 7 });
    sent = [];
    hub.bus.on('broadcast', (msg) => sent.push(msg));
  });

  it('carries currentTool through status and tool events', () => {
    hub.upsertSession(makeSession(), {});
    hub.setStatus('sess-1', 'working', { name: 'Bash', detail: 'pnpm build' });
    expect(hub.snapshot()[0]?.currentTool?.detail).toBe('pnpm build');

    hub.toolEvent('sess-1', 'start', { name: 'Edit', detail: 'src/index.ts' });
    expect(hub.snapshot()[0]?.currentTool?.name).toBe('Edit');
    hub.toolEvent('sess-1', 'end', { name: 'Edit', detail: 'src/index.ts' }, true);

    const toolMsgs = sent.filter((m) => m.type === 'event' && m.payload.kind === 'tool');
    expect(toolMsgs).toHaveLength(2);
  });

  it('updates stats and patches sessions', () => {
    hub.upsertSession(makeSession(), {});
    hub.updateStats('sess-1', { inputTokens: 9, outputTokens: 4, turns: 2, elapsedMs: 100 });
    expect(hub.snapshot()[0]?.stats.inputTokens).toBe(9);

    hub.patchSession('sess-1', { title: 'renamed' });
    expect(hub.snapshot()[0]?.title).toBe('renamed');

    hub.patchSession('ghost', { title: 'nobody' });
    hub.removeSession('ghost');
    expect(sent.filter((m) => m.type === 'session_removed')).toHaveLength(0);
  });

  it('routes voice prompts like typed prompts', async () => {
    const controller = { prompt: vi.fn() };
    hub.upsertSession(makeSession(), controller);
    const result = await hub.dispatch({
      v: 1,
      id: 'c-v',
      type: 'voice_prompt',
      payload: { sessionId: 'sess-1', text: 'approve the diff', lang: 'en-US' },
    });
    expect(result).toEqual({ ok: true });
    expect(controller.prompt).toHaveBeenCalledWith('approve the diff');
  });

  it('validates approve-family actions', async () => {
    hub.upsertSession(makeSession(), {});
    const noSession = await hub.dispatch({
      v: 1,
      id: 'c-a1',
      type: 'action',
      payload: { kind: 'deny' },
    });
    expect(noSession.ok).toBe(false);
    if (!noSession.ok) expect(noSession.code).toBe('bad_message');

    const nothingPending = await hub.dispatch({
      v: 1,
      id: 'c-a2',
      type: 'action',
      payload: { sessionId: 'sess-1', kind: 'always_allow' },
    });
    expect(nothingPending.ok).toBe(false);
  });

  it('validates lifecycle and extension actions', async () => {
    const runAction = vi.fn();
    hub.upsertSession(makeSession(), { runAction });

    const ghost = await hub.dispatch({
      v: 1,
      id: 'c-g',
      type: 'action',
      payload: { sessionId: 'ghost', kind: 'interrupt' },
    });
    expect(ghost.ok).toBe(false);

    const unwired = await hub.dispatch({
      v: 1,
      id: 'c-u',
      type: 'action',
      payload: { sessionId: 'sess-1', kind: 'interrupt' },
    });
    expect(unwired.ok).toBe(false);
    if (!unwired.ok) expect(unwired.code).toBe('unsupported');

    const custom = await hub.dispatch({
      v: 1,
      id: 'c-c',
      type: 'action',
      payload: { sessionId: 'sess-1', kind: 'compact' },
    });
    expect(custom).toEqual({ ok: true });
    expect(runAction).toHaveBeenCalledOnce();

    const noRunner = new Hub({ version: 't' });
    noRunner.upsertSession(makeSession(), {});
    const unsupported = await noRunner.dispatch({
      v: 1,
      id: 'c-n',
      type: 'action',
      payload: { sessionId: 'sess-1', kind: 'new_session' },
    });
    expect(unsupported.ok).toBe(false);

    const noSession = await noRunner.dispatch({
      v: 1,
      id: 'c-n2',
      type: 'action',
      payload: { kind: 'custom' },
    });
    expect(noSession.ok).toBe(false);
  });

  it('reports shell failures and missing runner', async () => {
    const failingRunner = vi.fn().mockResolvedValue({ ok: false, output: 'exit 1' });
    const shellHub = new Hub({
      version: 't',
      customActions: [{ id: 'lint', label: 'Lint', command: 'false' }],
      runShell: failingRunner,
    });
    shellHub.upsertSession(makeSession(), {});
    const failed = await shellHub.dispatch({
      v: 1,
      id: 'c-s1',
      type: 'action',
      payload: { sessionId: 'sess-1', kind: 'shell', args: { actionId: 'lint', confirmed: true } },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('internal');

    const runnerless = new Hub({
      version: 't',
      customActions: [{ id: 'lint', label: 'Lint', command: 'false' }],
    });
    const unsupported = await runnerless.dispatch({
      v: 1,
      id: 'c-s2',
      type: 'action',
      payload: { kind: 'shell', args: { actionId: 'lint', confirmed: true } },
    });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.code).toBe('unsupported');
  });

  it('answers set_effort with the adapter-applied value', async () => {
    hub.upsertSession(makeSession(), { setEffort: () => 'medium' });
    const result = await hub.dispatch({
      v: 1,
      id: 'c-e',
      type: 'set_effort',
      payload: { sessionId: 'sess-1', axis: 'effort', value: 'high' },
    });
    expect(result).toEqual({ ok: true, data: { axis: 'effort', value: 'medium' } });

    const unwired = new Hub({ version: 't' });
    unwired.upsertSession(makeSession(), {});
    const unsupported = await unwired.dispatch({
      v: 1,
      id: 'c-e2',
      type: 'set_effort',
      payload: { sessionId: 'sess-1', axis: 'effort', value: 'high' },
    });
    expect(unsupported.ok).toBe(false);

    const ghost = await unwired.dispatch({
      v: 1,
      id: 'c-e3',
      type: 'set_effort',
      payload: { sessionId: 'ghost', axis: 'effort', value: 'high' },
    });
    expect(ghost.ok).toBe(false);
  });

  it('exposes hello payloads and permission options', () => {
    hub.upsertSession(makeSession(), {});
    const { id } = hub.requestPermission('sess-1', { name: 'Bash', input: 'ls' }, [
      'approve',
      'deny',
    ]);
    const pending = hub.pendingPermissionsFor('sess-1');
    expect(pending[0]?.id).toBe(id);
    expect(pending[0]?.options).toEqual(['approve', 'deny']);

    const hello = hub.helloPayload('fresh');
    expect(hello.sessions).toHaveLength(1);
    expect(hello.seq).toBe(hub.currentSeq());

    expect(hub.replaySince(hub.currentSeq())).toEqual([]);
  });
});

describe('EventBus', () => {
  it('unsubscribes cleanly and tolerates events with no handlers', () => {
    const bus = new EventBus<{ tick: number }>();
    bus.emit('tick', 1);

    const seen: number[] = [];
    const off = bus.on('tick', (n) => seen.push(n));
    bus.emit('tick', 2);
    off();
    bus.emit('tick', 3);
    expect(seen).toEqual([2]);
  });
});

describe('logger and paths', () => {
  it('writes terminal lines through the term helpers', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    term.line('hello');
    term.line();
    term.error('bad');
    expect(out).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledTimes(1);
    out.mockRestore();
    err.mockRestore();
  });

  it('memoizes the pino instance under AGENTDECK_HOME', () => {
    const restore = tempHome();
    expect(logger()).toBe(logger());
    expect(agentdeckHome()).toBe(process.env.AGENTDECK_HOME);
    restore();
  });

  it('falls back to the home directory without AGENTDECK_HOME', () => {
    const previous = process.env.AGENTDECK_HOME;
    delete process.env.AGENTDECK_HOME;
    expect(agentdeckHome()).toContain('.agentdeck');
    if (previous !== undefined) process.env.AGENTDECK_HOME = previous;
  });
});

describe('runShellAction edge cases', () => {
  it('surfaces spawn failures as a failed run', async () => {
    const result = await runShellAction({
      id: 'bad-cwd',
      label: 'Bad cwd',
      command: 'echo hi',
      cwd: '/definitely/not/a/real/dir',
    });
    expect(result.ok).toBe(false);
  });
});
