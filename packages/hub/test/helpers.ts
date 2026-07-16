import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@agentdeck/protocol';

/** Points AGENTDECK_HOME at a throwaway dir; returns a cleanup fn. */
export function tempHome(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-test-'));
  const previous = process.env.AGENTDECK_HOME;
  process.env.AGENTDECK_HOME = dir;
  return () => {
    if (previous === undefined) delete process.env.AGENTDECK_HOME;
    else process.env.AGENTDECK_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  };
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    hubId: 'hub-1',
    harness: 'simulator',
    mode: 'managed',
    title: 'refactor payment retries',
    cwd: '/tmp/repo',
    status: 'working',
    statusSince: 1000,
    lastActivity: 1000,
    stats: { inputTokens: 0, outputTokens: 0, turns: 0, elapsedMs: 0 },
    capabilities: ['prompt', 'interrupt', 'approve'],
    ...overrides,
  };
}
