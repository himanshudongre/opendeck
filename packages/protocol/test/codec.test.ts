import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  decodeClientMsg,
  decodeServerMsg,
  encodeClientMsg,
  encodeServerMsg,
} from '../src/index.js';
import { allClientMsgs, allServerMsgs } from './fixtures.js';

describe('server message round-trips', () => {
  it.each(allServerMsgs.map((msg) => [msg.type, msg] as const))('round-trips %s', (_type, msg) => {
    const decoded = decodeServerMsg(encodeServerMsg(msg));
    expect(decoded).toEqual({ ok: true, msg });
  });

  it('covers every server message type', () => {
    const types = new Set(allServerMsgs.map((m) => m.type));
    expect([...types].sort()).toEqual([
      'ack',
      'error',
      'event',
      'hello',
      'permission_request',
      'permission_resolved',
      'pong',
      'session_removed',
      'session_upsert',
    ]);
  });

  it('covers every session event kind', () => {
    const kinds = new Set(
      allServerMsgs.flatMap((m) => (m.type === 'event' ? [m.payload.kind] : [])),
    );
    expect([...kinds].sort()).toEqual(['notice', 'stats', 'status', 'tool', 'transcript']);
  });

  it('decodes binary (Uint8Array) frames', () => {
    const msg = allServerMsgs[0];
    expect(msg).toBeDefined();
    if (!msg) return;
    const bytes = new TextEncoder().encode(encodeServerMsg(msg));
    expect(decodeServerMsg(bytes)).toEqual({ ok: true, msg });
  });

  it('decodes already-parsed objects', () => {
    const msg = allServerMsgs[1];
    expect(msg).toBeDefined();
    if (!msg) return;
    expect(decodeServerMsg(JSON.parse(encodeServerMsg(msg)))).toEqual({ ok: true, msg });
  });
});

describe('client message round-trips', () => {
  it.each(allClientMsgs.map((msg) => [`${msg.type} (${msg.id})`, msg] as const))(
    'round-trips %s',
    (_label, msg) => {
      const decoded = decodeClientMsg(encodeClientMsg(msg));
      expect(decoded).toEqual({ ok: true, msg });
    },
  );

  it('covers every client message type', () => {
    const types = new Set(allClientMsgs.map((m) => m.type));
    expect([...types].sort()).toEqual([
      'action',
      'permission_response',
      'ping',
      'prompt',
      'resume',
      'set_effort',
      'subscribe',
      'voice_prompt',
    ]);
  });
});

describe('malformed input rejection', () => {
  it('rejects non-JSON text', () => {
    const result = decodeServerMsg('not json {');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_json');
  });

  it('rejects an unknown message type', () => {
    const result = decodeClientMsg(
      JSON.stringify({ v: PROTOCOL_VERSION, id: 'c-1', type: 'teleport', payload: {} }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('rejects a valid type with a wrong payload shape', () => {
    const result = decodeClientMsg(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: 'c-1',
        type: 'prompt',
        payload: { sessionId: 'sess-1' },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('malformed');
      expect(result.message).toContain('payload');
    }
  });

  it('rejects an empty prompt', () => {
    const result = decodeClientMsg(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: 'c-1',
        type: 'prompt',
        payload: { sessionId: 'sess-1', text: '' },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a permission request with no options', () => {
    const result = decodeServerMsg(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        seq: 1,
        ts: 1,
        type: 'permission_request',
        payload: {
          id: 'perm-1',
          sessionId: 'sess-1',
          tool: { name: 'Bash', input: 'rm -rf node_modules' },
          options: [],
          requestedAt: 1,
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a session with an invalid status', () => {
    const result = decodeServerMsg(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        seq: 1,
        ts: 1,
        type: 'session_upsert',
        payload: { id: 'sess-1', status: 'daydreaming' },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a negative resume lastSeq', () => {
    const result = decodeClientMsg(
      JSON.stringify({ v: PROTOCOL_VERSION, id: 'c-1', type: 'resume', payload: { lastSeq: -1 } }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects missing envelope fields', () => {
    const result = decodeServerMsg(JSON.stringify({ type: 'pong', payload: { t: 1 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });
});

describe('version mismatch', () => {
  it('rejects a newer major with an upgrade message, before shape validation', () => {
    const result = decodeServerMsg(
      JSON.stringify({ v: PROTOCOL_VERSION + 1, seq: 1, ts: 1, type: 'not_even_real', payload: 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('version_mismatch');
      expect(result.message).toContain('npx agentdeck@latest');
    }
  });

  it('rejects an older major on the client codec too', () => {
    const result = decodeClientMsg(
      JSON.stringify({ v: 0, id: 'c-1', type: 'ping', payload: { t: 1 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('version_mismatch');
  });
});
