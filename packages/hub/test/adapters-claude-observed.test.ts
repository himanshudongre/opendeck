import { describe, expect, it } from 'vitest';
import { ClaudeHooksGateway } from '../src/adapters/claude/hooks.js';
import type { Hub } from '../src/core/hub.js';
import {
  loadFixtureLines,
  observedHub,
  runAdapterContract,
  statusSequence,
  type ContractObservations,
} from './adapter-contract.js';

function hookEvents(): unknown[] {
  return loadFixtureLines('claude-hooks.jsonl').map((line) => JSON.parse(line) as unknown);
}

function eventNamed(name: string): unknown {
  const found = hookEvents().find(
    (event) => (event as { hook_event_name: string }).hook_event_name === name,
  );
  if (found === undefined) throw new Error(`fixture missing ${name}`);
  return found;
}

/** Replays the whole hook fixture except the blocking permission event. */
async function replay(gateway: ClaudeHooksGateway, through?: string): Promise<void> {
  for (const event of hookEvents()) {
    const name = (event as { hook_event_name: string }).hook_event_name;
    if (name === 'PermissionRequest') continue;
    await gateway.handle(event);
    if (through !== undefined && name === through) return;
  }
}

async function playHappyPath(): Promise<ContractObservations> {
  const { hub, events } = observedHub();
  const gateway = new ClaudeHooksGateway(hub);
  await replay(gateway, 'Stop');
  const session = hub.snapshot()[0];
  if (!session) throw new Error('session vanished');
  return { session, events };
}

runAdapterContract({
  name: 'claude observed (hooks)',
  playHappyPath,
  // Hooks expose no usage or failure signal — those stay honest gaps.
  emitsUsageStats: false,
  permission: {
    approve: async () => {
      const { hub, events } = observedHub();
      hub.clientConnected();
      const gateway = new ClaudeHooksGateway(hub);
      await gateway.handle(eventNamed('SessionStart'));

      const pendingResponse = gateway.handle(eventNamed('PermissionRequest'));
      const sessionId = hub.snapshot()[0]?.id ?? '';
      const request = await waitForPending(hub, sessionId);
      expect(request.tool.diff).toContain('-const MAX_ATTEMPTS = 2;');
      expect(request.tool.diff).toContain('+const MAX_ATTEMPTS = 5;');

      await hub.dispatch({
        v: 1,
        id: 'c-a',
        type: 'permission_response',
        payload: { requestId: request.id, resolution: 'always_allow' },
      });
      const response = await pendingResponse;
      const body = response.status === 200 ? response.body : undefined;
      const output = body?.hookSpecificOutput as
        { decision: { behavior: string; updatedPermissions?: unknown } } | undefined;
      return {
        adapterSawAllow:
          output?.decision.behavior === 'allow' && output.decision.updatedPermissions !== undefined,
        events,
      };
    },
    deny: async () => {
      const { hub } = observedHub();
      hub.clientConnected();
      const gateway = new ClaudeHooksGateway(hub);
      await gateway.handle(eventNamed('SessionStart'));

      const pendingResponse = gateway.handle(eventNamed('PermissionRequest'));
      const sessionId = hub.snapshot()[0]?.id ?? '';
      const request = await waitForPending(hub, sessionId);
      await hub.dispatch({
        v: 1,
        id: 'c-d',
        type: 'permission_response',
        payload: { requestId: request.id, resolution: 'deny' },
      });
      const response = await pendingResponse;
      const body = response.status === 200 ? response.body : undefined;
      const output = body?.hookSpecificOutput as { decision: { behavior: string } } | undefined;
      return { adapterSawDeny: output?.decision.behavior === 'deny' };
    },
  },
});

async function waitForPending(
  hub: Hub,
  sessionId: string,
): Promise<ReturnType<Hub['pendingPermissionsFor']>[number]> {
  for (let i = 0; i < 100; i += 1) {
    const pending = hub.pendingPermissionsFor(sessionId)[0];
    if (pending) return pending;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('permission request never arrived');
}

describe('claude observed specifics', () => {
  it('maps the full hook lifecycle onto session statuses', async () => {
    const { hub, events } = observedHub();
    const gateway = new ClaudeHooksGateway(hub);
    await replay(gateway);

    expect(statusSequence(events)).toEqual([
      'idle',
      'thinking',
      'working',
      'waiting_input',
      'done',
    ]);
    // SessionEnd removed the session.
    expect(hub.snapshot()).toHaveLength(0);
    expect(events.some((m) => m.type === 'session_removed')).toBe(true);

    const session = events.find((m) => m.type === 'session_upsert');
    if (session?.type === 'session_upsert') {
      expect(session.payload.mode).toBe('observed');
      expect(session.payload.title).toBe('tighten webhook retries');
    }
  });

  it('falls back to the terminal prompt when no deck is connected', async () => {
    const { hub } = observedHub();
    const gateway = new ClaudeHooksGateway(hub);
    await gateway.handle(eventNamed('SessionStart'));
    const response = await gateway.handle(eventNamed('PermissionRequest'));
    expect(response.status).toBe(204);
  });

  it('falls back to the terminal prompt when the deck never answers', async () => {
    const { hub } = observedHub();
    hub.clientConnected();
    const gateway = new ClaudeHooksGateway(hub, { permissionWaitMs: 30 });
    await gateway.handle(eventNamed('SessionStart'));
    const response = await gateway.handle(eventNamed('PermissionRequest'));
    expect(response.status).toBe(204);
    // The stale request was dismissed, not left dangling.
    const sessionId = hub.snapshot()[0]?.id ?? '';
    expect(hub.pendingPermissionsFor(sessionId)).toHaveLength(0);
  });

  it('falls back to generic labels when hooks omit optional fields', async () => {
    const { hub, events } = observedHub();
    const gateway = new ClaudeHooksGateway(hub);
    const base = {
      session_id: 'sparse-1',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/dev/acme/api',
    };
    await gateway.handle({ ...base, hook_event_name: 'PreToolUse' });
    await gateway.handle({ ...base, hook_event_name: 'PostToolUse' });
    await gateway.handle({ ...base, hook_event_name: 'UserPromptSubmit' });
    await gateway.handle({ ...base, hook_event_name: 'Stop', last_assistant_message: '' });
    await gateway.handle({ ...base, hook_event_name: 'Notification', notification_type: 'other' });

    const session = hub.snapshot()[0];
    expect(session?.title).toBe('api');
    const toolStarts = events.filter(
      (m) => m.type === 'event' && m.payload.kind === 'tool' && m.payload.tool.name === 'Tool',
    );
    expect(toolStarts.length).toBeGreaterThan(0);
    expect(
      events.some(
        (m) =>
          m.type === 'event' && m.payload.kind === 'transcript' && m.payload.role === 'assistant',
      ),
    ).toBe(false);
  });

  it('ignores garbage payloads and managed-session echoes', async () => {
    const { hub, events } = observedHub();
    const gateway = new ClaudeHooksGateway(hub, {
      isManagedNativeId: (id) => id === 'managed-native',
    });
    expect((await gateway.handle({ nope: true })).status).toBe(204);
    expect(
      (
        await gateway.handle({
          session_id: 'managed-native',
          transcript_path: '/tmp/t.jsonl',
          cwd: '/home/dev',
          hook_event_name: 'SessionStart',
        })
      ).status,
    ).toBe(204);
    expect(events).toHaveLength(0);
  });
});
