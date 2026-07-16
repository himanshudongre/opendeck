import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HOOK_MARKER,
  connectClaude,
  disconnectClaude,
  hookCommand,
  settingsPathFor,
} from '../src/adapters/claude/connect.js';
import { tempHome } from './helpers.js';

let restoreHome: () => void;
let previousClaudeHome: string | undefined;

beforeEach(() => {
  restoreHome = tempHome();
  previousClaudeHome = process.env.AGENTDECK_CLAUDE_HOME;
  process.env.AGENTDECK_CLAUDE_HOME = join(process.env.AGENTDECK_HOME ?? '', 'claude-home');
});
afterEach(() => {
  if (previousClaudeHome === undefined) delete process.env.AGENTDECK_CLAUDE_HOME;
  else process.env.AGENTDECK_CLAUDE_HOME = previousClaudeHome;
  restoreHome();
});

function readSettings(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('agentdeck connect claude', () => {
  it('writes hooks for every lifecycle event plus the waiting permission hook', () => {
    const result = connectClaude({ scope: 'user', port: 3325 });
    expect(result.changed).toBe(true);

    const settings = readSettings(result.path);
    const hooks = settings.hooks as Record<
      string,
      { hooks: { command: string; timeout?: number }[] }[]
    >;
    expect(Object.keys(hooks).sort()).toEqual([
      'Notification',
      'PermissionRequest',
      'PostToolUse',
      'PreToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ]);
    expect(hooks.SessionStart?.[0]?.hooks[0]?.command).toContain(HOOK_MARKER);
    expect(hooks.SessionStart?.[0]?.hooks[0]?.command).toContain('--max-time 3');
    expect(hooks.PermissionRequest?.[0]?.hooks[0]?.command).toContain('--max-time 310');
    expect(hooks.PermissionRequest?.[0]?.hooks[0]?.timeout).toBe(320);
  });

  it('is idempotent: connecting twice changes nothing', () => {
    connectClaude({ scope: 'user', port: 3325 });
    const first = readFileSync(settingsPathFor({ scope: 'user', port: 3325 }), 'utf8');
    const second = connectClaude({ scope: 'user', port: 3325 });
    expect(second.changed).toBe(false);
    expect(readFileSync(second.path, 'utf8')).toBe(first);
  });

  it('replaces stale agentdeck hooks when the port changes', () => {
    connectClaude({ scope: 'user', port: 3325 });
    const result = connectClaude({ scope: 'user', port: 4000 });
    expect(result.changed).toBe(true);
    const raw = readFileSync(result.path, 'utf8');
    expect(raw).toContain(':4000/api/hooks/claude');
    expect(raw).not.toContain(':3325/api/hooks/claude');
  });

  it('preserves hooks that belong to other tools', () => {
    const path = settingsPathFor({ scope: 'user', port: 3325 });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        model: 'opus',
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
        },
      }),
    );

    connectClaude({ scope: 'user', port: 3325 });
    const settings = readSettings(path);
    expect(settings.model).toBe('opus');
    const stop = (settings.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop;
    expect(stop?.some((m) => m.hooks[0]?.command === 'say done')).toBe(true);
    expect(stop?.some((m) => m.hooks[0]?.command.includes(HOOK_MARKER))).toBe(true);

    const removed = disconnectClaude({ scope: 'user', port: 3325 });
    expect(removed.changed).toBe(true);
    const after = readSettings(path);
    const afterStop = (after.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop;
    expect(afterStop).toEqual([{ hooks: [{ type: 'command', command: 'say done' }] }]);
    expect(Object.keys(after.hooks as object)).toEqual(['Stop']);
  });

  it('disconnect removes the hooks block entirely when nothing else remains', () => {
    connectClaude({ scope: 'user', port: 3325 });
    const result = disconnectClaude({ scope: 'user', port: 3325 });
    expect(result.changed).toBe(true);
    const settings = readSettings(result.path);
    expect(settings.hooks).toBeUndefined();

    const again = disconnectClaude({ scope: 'user', port: 3325 });
    expect(again.changed).toBe(false);
  });

  it('supports project scope', () => {
    const projectDir = join(process.env.AGENTDECK_HOME ?? '', 'my-project');
    mkdirSync(projectDir, { recursive: true });
    const result = connectClaude({ scope: 'project', port: 3325, cwd: projectDir });
    expect(result.path).toBe(join(projectDir, '.claude', 'settings.json'));
    expect(result.changed).toBe(true);
  });

  it('refuses to clobber invalid settings JSON', () => {
    const path = settingsPathFor({ scope: 'user', port: 3325 });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ broken');
    expect(() => connectClaude({ scope: 'user', port: 3325 })).toThrow('not valid JSON');
  });

  it('builds hook commands that post stdin to the hub', () => {
    expect(hookCommand(3325, false)).toBe(
      'curl -sS --max-time 3 -X POST -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:3325/api/hooks/claude || true',
    );
    expect(hookCommand(3325, true)).toContain('--max-time 310');
  });
});
