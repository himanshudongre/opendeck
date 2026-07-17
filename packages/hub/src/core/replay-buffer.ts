import type { ServerMsg } from '@opendeck/protocol';

interface SessionRing {
  entries: ServerMsg[];
  /** Highest seq ever evicted from this ring; 0 = nothing evicted yet. */
  evictedThroughSeq: number;
}

export type ReplayResult = { ok: true; msgs: ServerMsg[] } | { ok: false; reason: 'gap' };

/**
 * Last-N replay buffer, one ring per session (SPEC §3.2: 1,000 events each).
 * Broadcast messages are recorded with their global seq; on `resume
 * { lastSeq }` the gap is replayed in seq order. If any ring has evicted a
 * message the client never saw, the gap is unrecoverable and the caller falls
 * back to a full snapshot hello.
 */
export class ReplayBuffer {
  private readonly rings = new Map<string, SessionRing>();

  constructor(private readonly capacityPerSession = 1000) {}

  record(sessionId: string, msg: ServerMsg): void {
    let ring = this.rings.get(sessionId);
    if (!ring) {
      ring = { entries: [], evictedThroughSeq: 0 };
      this.rings.set(sessionId, ring);
    }
    ring.entries.push(msg);
    if (ring.entries.length > this.capacityPerSession) {
      const evicted = ring.entries.shift();
      if (evicted) ring.evictedThroughSeq = evicted.seq;
    }
  }

  replaySince(lastSeq: number): ReplayResult {
    const msgs: ServerMsg[] = [];
    for (const ring of this.rings.values()) {
      if (ring.evictedThroughSeq > lastSeq) {
        return { ok: false, reason: 'gap' };
      }
      for (const msg of ring.entries) {
        if (msg.seq > lastSeq) msgs.push(msg);
      }
    }
    msgs.sort((a, b) => a.seq - b.seq);
    return { ok: true, msgs };
  }

  sessionCount(): number {
    return this.rings.size;
  }

  bufferedCount(sessionId: string): number {
    return this.rings.get(sessionId)?.entries.length ?? 0;
  }
}
