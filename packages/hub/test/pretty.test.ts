import { describe, expect, it } from 'vitest';
import {
  buildUnifiedDiff,
  diffForTool,
  prettyToolDetail,
  prettyToolInput,
  truncate,
} from '../src/adapters/pretty.js';

describe('prettyToolDetail', () => {
  it('prefers commands, then paths, then patterns', () => {
    expect(prettyToolDetail('Bash', { command: 'pnpm test' })).toBe('pnpm test');
    expect(prettyToolDetail('Edit', { file_path: 'src/a.ts', old_string: 'x' })).toBe('src/a.ts');
    expect(prettyToolDetail('Grep', { pattern: 'TODO' })).toBe('TODO');
  });

  it('flattens newlines and truncates long values', () => {
    const detail = prettyToolDetail('Bash', { command: `echo a\necho ${'b'.repeat(200)}` });
    expect(detail).not.toContain('\n');
    expect(detail.length).toBeLessThanOrEqual(80);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('falls back to key names, then the tool name', () => {
    expect(prettyToolDetail('Mystery', { alpha: 1, beta: 2 })).toBe('alpha, beta');
    expect(prettyToolDetail('Mystery', {})).toBe('Mystery');
    expect(prettyToolDetail('Mystery', 'not-an-object')).toBe('Mystery');
  });
});

describe('prettyToolInput', () => {
  it('shows the raw command for shell tools', () => {
    expect(prettyToolInput('Bash', { command: 'rm -rf node_modules && pnpm i' })).toBe(
      'rm -rf node_modules && pnpm i',
    );
  });

  it('lists scalar fields for structured inputs', () => {
    const input = prettyToolInput('WebFetch', {
      url: 'https://example.com',
      prompt: 'summarize',
      extra: { deep: 1 },
    });
    expect(input).toContain('url: https://example.com');
    expect(input).toContain('prompt: summarize');
    expect(input).not.toContain('deep');
  });
});

describe('diffForTool', () => {
  it('builds an Edit diff from old and new strings', () => {
    const diff = diffForTool('Edit', {
      file_path: 'src/auth.ts',
      old_string: 'const retries = 1;\nconst delay = 100;',
      new_string: 'const retries = 3;\nconst delay = 100;',
    });
    expect(diff).toContain('--- a/src/auth.ts');
    expect(diff).toContain('-const retries = 1;');
    expect(diff).toContain('+const retries = 3;');
    expect(diff).toContain(' const delay = 100;');
  });

  it('builds a Write diff against current contents when readable', () => {
    const diff = diffForTool('Write', { file_path: 'notes.md', content: 'two' }, () => 'one');
    expect(diff).toContain('-one');
    expect(diff).toContain('+two');
  });

  it('treats unreadable Write targets as new files', () => {
    const diff = diffForTool('Write', { file_path: 'new.md', content: 'hello' }, () => undefined);
    expect(diff).toContain('+hello');
    const removals = (diff ?? '')
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---'));
    expect(removals).toEqual([]);
  });

  it('returns nothing for non-editing tools or malformed input', () => {
    expect(diffForTool('Bash', { command: 'ls' })).toBeUndefined();
    expect(diffForTool('Edit', { file_path: 'a.ts' })).toBeUndefined();
    expect(diffForTool('Edit', { old_string: 'a', new_string: 'b' })).toBeUndefined();
  });
});

describe('buildUnifiedDiff', () => {
  it('clips enormous diffs with a count of hidden lines', () => {
    const before = Array.from({ length: 500 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 500 }, (_, i) => `new ${i}`).join('\n');
    const diff = buildUnifiedDiff('big.txt', before, after);
    expect(diff).toContain('more lines)');
    expect(diff.split('\n').length).toBeLessThan(500);
  });

  it('handles identical content and empty sides', () => {
    expect(buildUnifiedDiff('same.txt', 'a', 'a')).toBe('--- a/same.txt\n+++ b/same.txt\n');
    const added = buildUnifiedDiff('new.txt', '', 'line');
    expect(added).toContain('+line');
    const removed = buildUnifiedDiff('gone.txt', 'line', '');
    expect(removed).toContain('-line');
  });
});

describe('truncate', () => {
  it('leaves short strings alone and marks clipped ones', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly-ten', 11)).toBe('exactly-ten');
    expect(truncate('much too long for this', 10)).toBe('much too …');
  });
});
