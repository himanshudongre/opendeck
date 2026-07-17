import { serverMsg, type Session } from '@opendeck/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { aggregateStatus, useDeck } from '../src/state/store.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    hubId: 'hub-1',
    harness: 'claude',
    mode: 'managed',
    title: 'fix flaky auth test',
    cwd: '/home/dev/api',
    status: 'working',
    statusSince: 1000,
    lastActivity: 1000,
    stats: { inputTokens: 100, outputTokens: 20, costUsd: 0.01, turns: 1, elapsedMs: 5000 },
    capabilities: ['prompt', 'approve'],
    ...overrides,
  };
}

beforeEach(() => {
  useDeck.getState().reset();
});

describe('server message folding', () => {
  it('hello replaces the fleet and remembers the seq high-water mark', () => {
    const { applyServerMsg } = useDeck.getState();
    applyServerMsg(
      serverMsg(
        'hello',
        {
          hubId: 'hub-1',
          hubVersion: '1.0.0',
          seq: 40,
          sessions: [makeSession(), makeSession({ id: 'sess-2', title: 'second' })],
          resume: 'fresh',
        },
        40,
      ),
    );
    const state = useDeck.getState();
    expect(Object.keys(state.sessions)).toHaveLength(2);
    expect(state.order).toEqual(['sess-1', 'sess-2']);
    expect(state.lastSeq).toBe(40);
    expect(state.hubVersion).toBe('1.0.0');
  });

  it('hello keeps known ordering across snapshots', () => {
    const { applyServerMsg, moveSession } = useDeck.getState();
    applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    applyServerMsg(serverMsg('session_upsert', makeSession({ id: 'sess-2' }), 2));
    moveSession('sess-2', -1);
    applyServerMsg(
      serverMsg(
        'hello',
        {
          hubId: 'hub-1',
          hubVersion: '1.0.0',
          seq: 50,
          sessions: [makeSession(), makeSession({ id: 'sess-2' }), makeSession({ id: 'sess-3' })],
          resume: 'snapshot',
        },
        50,
      ),
    );
    expect(useDeck.getState().order).toEqual(['sess-2', 'sess-1', 'sess-3']);
  });

  it('upserts and removals maintain order, focus, and permissions', () => {
    const { applyServerMsg, focusSession } = useDeck.getState();
    applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    focusSession('sess-1');
    applyServerMsg(
      serverMsg(
        'permission_request',
        {
          id: 'perm-1',
          sessionId: 'sess-1',
          tool: { name: 'Edit', input: 'src/a.ts' },
          options: ['approve', 'deny'],
          requestedAt: 1,
        },
        2,
      ),
    );
    expect(Object.keys(useDeck.getState().permissions)).toEqual(['perm-1']);
    expect(useDeck.getState().screen).toBe('focus');

    applyServerMsg(serverMsg('session_removed', { sessionId: 'sess-1' }, 3));
    const state = useDeck.getState();
    expect(state.sessions['sess-1']).toBeUndefined();
    expect(state.order).toEqual([]);
    expect(state.permissions).toEqual({});
    expect(state.focusedSessionId).toBeNull();
    expect(state.screen).toBe('grid');
  });

  it('folds status, tool, and stats events into the session', () => {
    const { applyServerMsg } = useDeck.getState();
    applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    applyServerMsg(
      serverMsg(
        'event',
        { kind: 'status', sessionId: 'sess-1', status: 'waiting_permission', statusSince: 2000 },
        2,
      ),
    );
    applyServerMsg(
      serverMsg(
        'event',
        {
          kind: 'tool',
          sessionId: 'sess-1',
          phase: 'start',
          tool: { name: 'Bash', detail: 'pnpm test' },
        },
        3,
      ),
    );
    applyServerMsg(
      serverMsg(
        'event',
        {
          kind: 'stats',
          sessionId: 'sess-1',
          stats: { inputTokens: 900, outputTokens: 80, turns: 2, elapsedMs: 9000 },
        },
        4,
      ),
    );
    const session = useDeck.getState().sessions['sess-1'];
    expect(session?.status).toBe('waiting_permission');
    expect(session?.currentTool?.detail).toBe('pnpm test');
    expect(session?.stats.inputTokens).toBe(900);
    expect(useDeck.getState().lastSeq).toBe(4);
  });

  it('streams transcripts only for sessions the deck focused', () => {
    const { applyServerMsg, focusSession } = useDeck.getState();
    applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    applyServerMsg(
      serverMsg(
        'event',
        { kind: 'transcript', sessionId: 'sess-1', role: 'assistant', text: 'ignored', done: true },
        2,
      ),
    );
    expect(useDeck.getState().transcripts['sess-1']).toBeUndefined();

    focusSession('sess-1');
    applyServerMsg(
      serverMsg(
        'event',
        { kind: 'transcript', sessionId: 'sess-1', role: 'assistant', text: 'kept', done: true },
        3,
      ),
    );
    expect(useDeck.getState().transcripts['sess-1']).toHaveLength(1);
  });

  it('caps the ticker at fifty entries and records errors', () => {
    const { applyServerMsg } = useDeck.getState();
    applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    for (let i = 0; i < 60; i += 1) {
      applyServerMsg(
        serverMsg(
          'event',
          { kind: 'notice', sessionId: 'sess-1', level: 'info', text: `note ${String(i)}` },
          i + 2,
        ),
      );
    }
    applyServerMsg(
      serverMsg('error', { code: 'unknown_session', message: 'Session ghost is gone.' }, 99),
    );
    const ticker = useDeck.getState().ticker;
    expect(ticker.length).toBeLessThanOrEqual(50);
    expect(ticker.at(-1)?.level).toBe('error');
    expect(ticker.at(-1)?.text).toContain('ghost');
  });

  it('drops permission cards on resolution', () => {
    const { applyServerMsg } = useDeck.getState();
    applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    applyServerMsg(
      serverMsg(
        'permission_request',
        {
          id: 'perm-1',
          sessionId: 'sess-1',
          tool: { name: 'Bash', input: 'ls' },
          options: ['approve', 'deny'],
          requestedAt: 1,
        },
        2,
      ),
    );
    applyServerMsg(
      serverMsg(
        'permission_resolved',
        { requestId: 'perm-1', sessionId: 'sess-1', outcome: 'approve', source: 'deck' },
        3,
      ),
    );
    expect(useDeck.getState().permissions).toEqual({});
  });
});

describe('local state actions', () => {
  it('reorders sessions within bounds', () => {
    const { applyServerMsg, moveSession } = useDeck.getState();
    applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    applyServerMsg(serverMsg('session_upsert', makeSession({ id: 'sess-2' }), 2));
    moveSession('sess-1', -1);
    expect(useDeck.getState().order).toEqual(['sess-1', 'sess-2']);
    moveSession('sess-1', 1);
    expect(useDeck.getState().order).toEqual(['sess-2', 'sess-1']);
    moveSession('ghost', 1);
    expect(useDeck.getState().order).toEqual(['sess-2', 'sess-1']);
  });

  it('persists settings and layout to localStorage', () => {
    useDeck.getState().updateSettings({ sound: 'off', haptics: false });
    expect(JSON.parse(localStorage.getItem('opendeck.settings') ?? '{}')).toMatchObject({
      sound: 'off',
      haptics: false,
    });
    useDeck.getState().setLayoutPreset('tablet');
    useDeck.getState().setTileSize('L');
    expect(JSON.parse(localStorage.getItem('opendeck.layout') ?? '{}')).toMatchObject({
      preset: 'tablet',
      tileSize: 'L',
    });
  });
});

describe('aggregateStatus', () => {
  it('prioritizes error > waiting > working > thinking > idle', () => {
    expect(aggregateStatus([])).toBe('idle');
    expect(aggregateStatus([makeSession({ status: 'thinking' })])).toBe('thinking');
    expect(
      aggregateStatus([makeSession({ status: 'thinking' }), makeSession({ status: 'working' })]),
    ).toBe('working');
    expect(
      aggregateStatus([
        makeSession({ status: 'working' }),
        makeSession({ status: 'waiting_input' }),
      ]),
    ).toBe('waiting');
    expect(
      aggregateStatus([
        makeSession({ status: 'waiting_permission' }),
        makeSession({ status: 'error' }),
      ]),
    ).toBe('error');
    expect(aggregateStatus([makeSession({ status: 'done' })])).toBe('idle');
  });
});
