import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hub } from '../src/core/hub.js';

const execaMock = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: execaMock }));

const { ClaudeManagedAdapter } = await import('../src/adapters/claude/managed.js');
const { CodexAdapter } = await import('../src/adapters/codex/exec.js');

function hub(): Hub {
  return new Hub({ version: '1.0.0-detect' });
}

afterEach(() => {
  execaMock.mockReset();
});

describe('detect() against controlled binaries', () => {
  it('parses the claude version banner', async () => {
    execaMock.mockResolvedValueOnce({ stdout: '2.1.101 (Claude Code)' });
    const result = await new ClaudeManagedAdapter(hub()).detect();
    expect(result).toEqual({
      installed: true,
      version: '2.1.101',
      note: 'Claude Code 2.1.101 detected',
    });
  });

  it('reports a missing claude binary', async () => {
    execaMock.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await new ClaudeManagedAdapter(hub()).detect();
    expect(result).toEqual({ installed: false, note: 'Claude Code not installed' });
  });

  it('reports a missing codex binary', async () => {
    execaMock.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await new CodexAdapter(hub()).detect();
    expect(result).toEqual({ installed: false, note: 'Codex not installed' });
  });

  it('verifies codex exec --json before enabling managed sessions', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: 'codex-cli 0.98.0' })
      .mockResolvedValueOnce({ stdout: 'Usage: codex exec [OPTIONS]\n  --json  emit JSONL' });
    const result = await new CodexAdapter(hub()).detect();
    expect(result.installed).toBe(true);
    expect(result.version).toBe('0.98.0');
    expect(result.note).toBe('Codex 0.98.0 detected');
  });

  it('degrades when the installed codex dropped --json', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: 'codex-cli 0.42.0' })
      .mockResolvedValueOnce({ stdout: 'Usage: codex exec [OPTIONS]' });
    const result = await new CodexAdapter(hub()).detect();
    expect(result.installed).toBe(true);
    expect(result.note).toContain('managed sessions disabled');
  });

  it('degrades when codex exec itself fails', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: 'codex-cli 0.42.0' })
      .mockRejectedValueOnce(new Error('boom'));
    const result = await new CodexAdapter(hub()).detect();
    expect(result.installed).toBe(true);
    expect(result.note).toContain('`codex exec` failed');
  });
});
