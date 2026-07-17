import { encodeServerMsg, serverMsg, type ServerMsg } from '@agentdeck/protocol';
import { describe, expect, it } from 'vitest';
import {
  BACKOFF_MAX_MS,
  DEAD_AFTER_MS,
  DeckConnection,
  PING_INTERVAL_MS,
  type WebSocketLike,
} from '../src/lib/connection.js';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: ServerMsg): void {
    this.onmessage?.({ data: encodeServerMsg(msg) });
  }
}

interface Harness {
  connection: DeckConnection;
  sockets: FakeSocket[];
  urls: string[];
  states: string[];
  received: ServerMsg[];
  latencies: number[];
  advance: (ms: number) => void;
  now: () => number;
}

function makeHarness(): Harness {
  let clock = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let timerId = 0;
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const states: string[] = [];
  const received: ServerMsg[] = [];
  const latencies: number[] = [];

  const connection = new DeckConnection(
    'http://hub.local:3325',
    { deviceId: 'device-1', credential: 'secret' },
    {
      onMsg: (msg) => received.push(msg),
      onState: (state) => states.push(state),
      onLatency: (ms) => latencies.push(ms),
    },
    {
      wsFactory: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      now: () => clock,
      random: () => 0.5,
      setTimer: (fn, ms) => {
        timerId += 1;
        timers.push({ at: clock + ms, fn, id: timerId });
        return timerId;
      },
      clearTimer: (id) => {
        const index = timers.findIndex((timer) => timer.id === id);
        if (index !== -1) timers.splice(index, 1);
      },
    },
  );

  return {
    connection,
    sockets,
    urls,
    states,
    received,
    latencies,
    now: () => clock,
    advance: (ms) => {
      const target = clock + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        clock = next.at;
        timers.splice(timers.indexOf(next), 1);
        next.fn();
      }
      clock = target;
    },
  };
}

describe('DeckConnection', () => {
  it('authenticates via query params and reports connected', () => {
    const h = makeHarness();
    h.connection.start();
    expect(h.urls[0]).toContain('ws://hub.local:3325/ws?');
    expect(h.urls[0]).toContain('device=device-1');
    expect(h.urls[0]).toContain('credential=secret');
    expect(h.urls[0]).not.toContain('lastSeq');
    h.sockets[0]?.open();
    expect(h.states).toEqual(['connected']);
  });

  it('pings every five seconds and measures latency from pong', () => {
    const h = makeHarness();
    h.connection.start();
    h.sockets[0]?.open();
    expect(h.sockets[0]?.sent.filter((m) => m.includes('"ping"'))).toHaveLength(1);

    h.advance(PING_INTERVAL_MS);
    expect(h.sockets[0]?.sent.filter((m) => m.includes('"ping"'))).toHaveLength(2);

    h.sockets[0]?.receive(serverMsg('pong', { t: h.now() - 42 }, 0));
    expect(h.latencies).toEqual([42]);
  });

  it('declares the socket dead after 12 s of silence and reconnects with lastSeq', () => {
    const h = makeHarness();
    h.connection.start();
    h.sockets[0]?.open();
    h.sockets[0]?.receive(
      serverMsg('event', { kind: 'notice', sessionId: 's', level: 'info', text: 'tick' }, 17),
    );

    h.advance(DEAD_AFTER_MS + PING_INTERVAL_MS + 1);
    expect(h.states).toContain('reconnecting');

    h.advance(BACKOFF_MAX_MS);
    expect(h.urls.length).toBeGreaterThan(1);
    expect(h.urls.at(-1)).toContain('lastSeq=17');
  });

  it('backs off with a cap and resets after a successful connect', () => {
    const h = makeHarness();
    h.connection.start();
    // Refuse the first several sockets.
    for (let i = 0; i < 6; i += 1) {
      h.sockets.at(-1)?.close();
      h.advance(BACKOFF_MAX_MS + 1);
    }
    expect(h.urls.length).toBeGreaterThan(4);

    h.sockets.at(-1)?.open();
    expect(h.states.at(-1)).toBe('connected');
  });

  it('tracks seq only from broadcast message types', () => {
    const h = makeHarness();
    h.connection.start();
    h.sockets[0]?.open();
    h.sockets[0]?.receive(
      serverMsg(
        'hello',
        { hubId: 'h', hubVersion: '1', seq: 30, sessions: [], resume: 'fresh' },
        0,
      ),
    );
    h.sockets[0]?.receive(serverMsg('pong', { t: 0 }, 99));
    expect(h.connection.currentSeq()).toBe(30);

    h.sockets[0]?.receive(serverMsg('session_removed', { sessionId: 's' }, 44));
    expect(h.connection.currentSeq()).toBe(44);
    expect(h.received.length).toBeGreaterThanOrEqual(3);
  });

  it('stops cleanly and never reconnects after stop()', () => {
    const h = makeHarness();
    h.connection.start();
    h.sockets[0]?.open();
    h.connection.stop();
    h.advance(BACKOFF_MAX_MS * 4);
    expect(h.urls).toHaveLength(1);
  });
});
