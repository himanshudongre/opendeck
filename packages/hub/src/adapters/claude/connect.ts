import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * `agentdeck connect claude` — writes idempotent hook config into Claude
 * Code's settings.json (user or project scope, SPEC §4.1) so terminal
 * sessions report to the hub over HTTP. `disconnect` removes exactly what
 * connect added and nothing else.
 */

/** Marker every AgentDeck-managed hook command contains. */
export const HOOK_MARKER = '/api/hooks/claude';

/** Events the hub only observes; the hook must never block the CLI. */
const FAST_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;

/** The approval round-trip: waits for a deck decision (SPEC §4.1). */
const WAIT_EVENT = 'PermissionRequest';
const WAIT_HOOK_TIMEOUT_S = 320;

export type ConnectScope = 'user' | 'project';

export interface ConnectOptions {
  scope: ConnectScope;
  port: number;
  /** Project directory when scope is `project`. */
  cwd?: string;
}

interface HookEntry {
  type: 'command';
  command: string;
  timeout?: number;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
  [key: string]: unknown;
}

type SettingsShape = Record<string, unknown> & {
  hooks?: Record<string, HookMatcher[]>;
};

export function settingsPathFor(options: ConnectOptions): string {
  return options.scope === 'user'
    ? join(process.env.AGENTDECK_CLAUDE_HOME ?? join(homedir(), '.claude'), 'settings.json')
    : join(options.cwd ?? process.cwd(), '.claude', 'settings.json');
}

export function hookCommand(port: number, wait: boolean): string {
  const maxTime = wait ? 310 : 3;
  return `curl -sS --max-time ${maxTime} -X POST -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:${port}${HOOK_MARKER} || true`;
}

function readSettings(path: string): SettingsShape {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as SettingsShape) : {};
  } catch {
    throw new Error(`${path} is not valid JSON. Fix or remove it, then rerun connect.`);
  }
}

function writeSettings(path: string, settings: SettingsShape): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function isAgentdeckMatcher(matcher: HookMatcher): boolean {
  return matcher.hooks.some((hook) => hook.command.includes(HOOK_MARKER));
}

/** Removes AgentDeck entries from one event's matcher list, preserving others. */
function withoutAgentdeck(matchers: HookMatcher[] | undefined): HookMatcher[] {
  return (matchers ?? []).filter((matcher) => !isAgentdeckMatcher(matcher));
}

export function connectClaude(options: ConnectOptions): { path: string; changed: boolean } {
  const path = settingsPathFor(options);
  const settings = readSettings(path);
  const before = JSON.stringify(settings.hooks ?? {});
  const hooks: Record<string, HookMatcher[]> = { ...(settings.hooks ?? {}) };

  for (const event of FAST_EVENTS) {
    hooks[event] = [
      ...withoutAgentdeck(hooks[event]),
      { hooks: [{ type: 'command', command: hookCommand(options.port, false) }] },
    ];
  }
  hooks[WAIT_EVENT] = [
    ...withoutAgentdeck(hooks[WAIT_EVENT]),
    {
      hooks: [
        {
          type: 'command',
          command: hookCommand(options.port, true),
          timeout: WAIT_HOOK_TIMEOUT_S,
        },
      ],
    },
  ];

  settings.hooks = hooks;
  const changed = JSON.stringify(hooks) !== before;
  if (changed) writeSettings(path, settings);
  return { path, changed };
}

export function disconnectClaude(options: ConnectOptions): { path: string; changed: boolean } {
  const path = settingsPathFor(options);
  const settings = readSettings(path);
  if (settings.hooks === undefined) return { path, changed: false };

  let changed = false;
  const hooks: Record<string, HookMatcher[]> = {};
  for (const [event, matchers] of Object.entries(settings.hooks)) {
    const kept = withoutAgentdeck(matchers);
    if (kept.length !== matchers.length) changed = true;
    if (kept.length > 0) hooks[event] = kept;
  }

  if (!changed) return { path, changed: false };
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  else settings.hooks = hooks;
  writeSettings(path, settings);
  return { path, changed: true };
}
