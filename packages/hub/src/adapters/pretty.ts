/*
 * Turns raw tool inputs into the short detail line on tiles and the pretty
 * body + unified-diff preview on permission cards. Pure functions — shared by
 * the managed adapter and the hooks gateway, covered by the contract suite.
 */

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** One short line for the tile: `pnpm test`, `src/auth.ts`, … */
export function prettyToolDetail(toolName: string, rawInput: unknown): string {
  const input = record(rawInput);
  const candidate =
    asString(input.command) ??
    asString(input.file_path) ??
    asString(input.path) ??
    asString(input.pattern) ??
    asString(input.url) ??
    asString(input.query) ??
    asString(input.description);
  if (candidate !== undefined) return truncate(candidate.replaceAll('\n', ' '), 80);
  const keys = Object.keys(input);
  return keys.length === 0 ? toolName : truncate(keys.join(', '), 80);
}

/** Multiline pretty input for the permission card body. */
export function prettyToolInput(toolName: string, rawInput: unknown): string {
  const input = record(rawInput);
  const command = asString(input.command);
  if (command !== undefined) return command;
  const filePath = asString(input.file_path) ?? asString(input.path);
  if (filePath !== undefined && Object.keys(input).length <= 3) return filePath;
  const entries = Object.entries(input)
    .filter(([, value]) => typeof value !== 'object')
    .map(([key, value]) => `${key}: ${truncate(String(value), 200)}`);
  return entries.length > 0 ? entries.join('\n') : toolName;
}

/**
 * Unified-diff preview for file-editing tools. `readFile` supplies current
 * contents for whole-file writes; absent or failing reads degrade to an
 * empty "before" (a new file).
 */
export function diffForTool(
  toolName: string,
  rawInput: unknown,
  readFile?: (path: string) => string | undefined,
): string | undefined {
  const input = record(rawInput);
  const filePath = asString(input.file_path) ?? asString(input.path);
  if (filePath === undefined) return undefined;

  if (toolName === 'Edit') {
    const oldString = asString(input.old_string);
    const newString = asString(input.new_string);
    if (oldString === undefined || newString === undefined) return undefined;
    return buildUnifiedDiff(filePath, oldString, newString);
  }
  if (toolName === 'Write') {
    const content = asString(input.content);
    if (content === undefined) return undefined;
    const before = readFile?.(filePath) ?? '';
    return buildUnifiedDiff(filePath, before, content);
  }
  return undefined;
}

const MAX_DIFF_LINES = 400;

/** Minimal LCS-based unified diff — permission previews, not patch tooling. */
export function buildUnifiedDiff(filePath: string, before: string, after: string): string {
  if (before === after) return `--- a/${filePath}\n+++ b/${filePath}\n`;
  const a = before.length === 0 ? [] : before.split('\n');
  const b = after.length === 0 ? [] : after.split('\n');

  // LCS table; inputs are permission previews, small by construction.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs: number[] = new Array<number>(rows * cols).fill(0);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * cols + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * cols + j] ?? 0, lcs[i * cols + j + 1] ?? 0);
    }
  }

  const body: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      body.push(` ${a[i] ?? ''}`);
      i += 1;
      j += 1;
    } else if ((lcs[(i + 1) * cols + j] ?? 0) >= (lcs[i * cols + j + 1] ?? 0)) {
      body.push(`-${a[i] ?? ''}`);
      i += 1;
    } else {
      body.push(`+${b[j] ?? ''}`);
      j += 1;
    }
  }
  while (i < a.length) {
    body.push(`-${a[i] ?? ''}`);
    i += 1;
  }
  while (j < b.length) {
    body.push(`+${b[j] ?? ''}`);
    j += 1;
  }

  const clipped = body.length > MAX_DIFF_LINES ? body.slice(0, MAX_DIFF_LINES) : body;
  const header = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${a.length} +1,${b.length} @@\n`;
  const suffix =
    body.length > MAX_DIFF_LINES ? `\n(+${body.length - MAX_DIFF_LINES} more lines)` : '';
  return `${header}${clipped.join('\n')}${suffix}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
