import { serverMsg, type ServerMsg } from '@opendeck/protocol';
import { describe, expect, it } from 'vitest';
import { ReplayBuffer } from '../src/core/replay-buffer.js';

function notice(sessionId: string, seq: number): ServerMsg {
  return serverMsg(
    'event',
    { kind: 'notice', sessionId, level: 'info', text: `event ${seq}` },
    seq,
    seq,
  );
}

describe('ReplayBuffer', () => {
  it('replays only messages after lastSeq, in seq order across sessions', () => {
    const buffer = new ReplayBuffer(10);
    buffer.record('a', notice('a', 1));
    buffer.record('b', notice('b', 2));
    buffer.record('a', notice('a', 3));
    buffer.record('b', notice('b', 4));

    const result = buffer.replaySince(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.msgs.map((m) => m.seq)).toEqual([3, 4]);
    }
  });

  it('replays nothing when the client is current', () => {
    const buffer = new ReplayBuffer(10);
    buffer.record('a', notice('a', 1));
    const result = buffer.replaySince(1);
    expect(result).toEqual({ ok: true, msgs: [] });
  });

  it('evicts beyond capacity and reports a gap for stale clients', () => {
    const buffer = new ReplayBuffer(3);
    for (let seq = 1; seq <= 5; seq += 1) buffer.record('a', notice('a', seq));

    expect(buffer.bufferedCount('a')).toBe(3);
    // seqs 1 and 2 were evicted: a client at lastSeq 1 missed seq 2 forever.
    expect(buffer.replaySince(1)).toEqual({ ok: false, reason: 'gap' });
    // A client at lastSeq 2 saw everything that was evicted — still resumable.
    const ok = buffer.replaySince(2);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.msgs.map((m) => m.seq)).toEqual([3, 4, 5]);
  });

  it('a gap in any session ring fails the whole resume', () => {
    const buffer = new ReplayBuffer(1);
    buffer.record('a', notice('a', 1));
    buffer.record('a', notice('a', 2)); // evicts seq 1
    buffer.record('b', notice('b', 3));

    expect(buffer.replaySince(0)).toEqual({ ok: false, reason: 'gap' });
    const ok = buffer.replaySince(1);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.msgs.map((m) => m.seq)).toEqual([2, 3]);
  });

  it('holds exactly 1,000 events per session by default', () => {
    const buffer = new ReplayBuffer();
    for (let seq = 1; seq <= 1200; seq += 1) buffer.record('a', notice('a', seq));
    expect(buffer.bufferedCount('a')).toBe(1000);
    const result = buffer.replaySince(200);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.msgs).toHaveLength(1000);
      expect(result.msgs[0]?.seq).toBe(201);
    }
    expect(buffer.replaySince(199)).toEqual({ ok: false, reason: 'gap' });
  });

  it('tracks sessions independently', () => {
    const buffer = new ReplayBuffer(2);
    buffer.record('a', notice('a', 1));
    buffer.record('b', notice('b', 2));
    expect(buffer.sessionCount()).toBe(2);
    expect(buffer.bufferedCount('a')).toBe(1);
    expect(buffer.bufferedCount('missing')).toBe(0);
  });
});
