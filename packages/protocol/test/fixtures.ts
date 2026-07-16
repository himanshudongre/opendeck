import type {
  Action,
  ClientMsg,
  PermissionRequest,
  PermissionResolved,
  ServerMsg,
  Session,
  SessionEvent,
} from '../src/index.js';
import { clientMsg, serverMsg } from '../src/index.js';

export const session: Session = {
  id: 'sess-1',
  hubId: 'hub-1',
  harness: 'claude',
  mode: 'managed',
  title: 'fix flaky auth test',
  cwd: '/home/dev/api',
  repo: 'acme/api',
  branch: 'fix/auth-retry',
  model: 'claude-sonnet-5',
  status: 'working',
  statusSince: 1_700_000_000_000,
  lastActivity: 1_700_000_012_000,
  currentTool: { name: 'Bash', detail: 'pnpm test' },
  stats: { inputTokens: 1200, outputTokens: 300, costUsd: 0.04, turns: 3, elapsedMs: 45_000 },
  capabilities: ['prompt', 'interrupt', 'approve', 'set_effort', 'resume', 'kill', 'transcript'],
};

export const events: SessionEvent[] = [
  {
    kind: 'status',
    sessionId: 'sess-1',
    status: 'waiting_permission',
    statusSince: 1_700_000_020_000,
    currentTool: { name: 'Edit', detail: 'src/auth.ts' },
  },
  {
    kind: 'transcript',
    sessionId: 'sess-1',
    role: 'assistant',
    text: 'Running tests…',
    done: false,
  },
  {
    kind: 'tool',
    sessionId: 'sess-1',
    phase: 'end',
    tool: { name: 'Bash', detail: 'pnpm test' },
    ok: true,
  },
  {
    kind: 'stats',
    sessionId: 'sess-1',
    stats: { inputTokens: 100, outputTokens: 20, turns: 1, elapsedMs: 900 },
  },
  { kind: 'notice', sessionId: 'sess-1', level: 'info', text: 'Session resumed' },
];

export const permissionRequest: PermissionRequest = {
  id: 'perm-1',
  sessionId: 'sess-1',
  tool: {
    name: 'Edit',
    input: 'src/auth.ts',
    diff: '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-const retries = 1;\n+const retries = 3;\n',
  },
  options: ['approve', 'deny', 'always_allow'],
  requestedAt: 1_700_000_021_000,
};

export const permissionResolved: PermissionResolved = {
  requestId: 'perm-1',
  sessionId: 'sess-1',
  outcome: 'approve',
  source: 'deck',
};

export const action: Action = {
  sessionId: 'sess-1',
  kind: 'prompt_template',
  args: { template: 'fix-failing-tests', dryRun: false, retries: 2 },
};

/** One of every server message type — the round-trip suite iterates this. */
export const allServerMsgs: ServerMsg[] = [
  serverMsg(
    'hello',
    {
      hubId: 'hub-1',
      hubVersion: '1.0.0',
      seq: 41,
      sessions: [session],
      resume: 'fresh',
    },
    0,
    1_700_000_000_000,
  ),
  serverMsg('session_upsert', session, 1, 1_700_000_000_100),
  serverMsg('session_removed', { sessionId: 'sess-1' }, 2, 1_700_000_000_200),
  ...events.map((event, i) => serverMsg('event', event, 3 + i, 1_700_000_000_300)),
  serverMsg('permission_request', permissionRequest, 8, 1_700_000_000_400),
  serverMsg('permission_resolved', permissionResolved, 9, 1_700_000_000_500),
  serverMsg('ack', { id: 'client-msg-1', data: { axis: 'effort', value: 'high' } }, 10),
  serverMsg(
    'error',
    { code: 'unknown_session', message: 'No such session.', id: 'client-msg-2' },
    11,
  ),
  serverMsg('pong', { t: 1_700_000_000_600 }, 12),
];

/** One of every client message type. */
export const allClientMsgs: ClientMsg[] = [
  clientMsg('subscribe', { sessionId: 'sess-1' }, 'c-1'),
  clientMsg('subscribe', { sessionId: null }, 'c-2'),
  clientMsg('action', action, 'c-3'),
  clientMsg('permission_response', { requestId: 'perm-1', resolution: 'always_allow' }, 'c-4'),
  clientMsg('set_effort', { sessionId: 'sess-1', axis: 'thinking', value: '16k' }, 'c-5'),
  clientMsg('prompt', { sessionId: 'sess-1', text: 'run the tests again' }, 'c-6'),
  clientMsg('voice_prompt', { sessionId: 'sess-1', text: 'review the diff', lang: 'en-US' }, 'c-7'),
  clientMsg('ping', { t: 1_700_000_000_700 }, 'c-8'),
  clientMsg('resume', { lastSeq: 41 }, 'c-9'),
];
