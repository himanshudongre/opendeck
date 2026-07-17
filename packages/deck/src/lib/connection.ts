import {
  clientMsg,
  decodeServerMsg,
  encodeClientMsg,
  type ClientMsgType,
  type ClientPayload,
  type ServerMsg,
} from '@agentdeck/protocol';

/**
 * The deck side of SPEC §3.2: heartbeat every 5 s, dead after 12 s of
 * silence, reconnect with 0.5 s → 8 s full-jitter backoff, forever, resuming
 * via lastSeq in the connect query so no status change is ever missed.
 */

export const PING_INTERVAL_MS = 5_000;
export const DEAD_AFTER_MS = 12_000;
export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 8_000;

export interface WebSocketLike {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface ConnectionCallbacks {
  onMsg: (msg: ServerMsg) => void;
  onState: (state: 'connected' | 'reconnecting') => void;
  onLatency: (ms: number) => void;
}

export interface ConnectionDeps {
  wsFactory?: (url: string) => WebSocketLike;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
}

export interface Credentials {
  deviceId: string;
  credential: string;
}

export class DeckConnection {
  private ws: WebSocketLike | undefined;
  private lastSeq = 0;
  private lastHeardAt = 0;
  private attempt = 0;
  private stopped = false;
  private heartbeatHandle: number | undefined;
  private reconnectHandle: number | undefined;
  private msgCounter = 0;

  private readonly wsFactory: (url: string) => WebSocketLike;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;

  constructor(
    private readonly baseUrl: string,
    private readonly credentials: Credentials | undefined,
    private readonly callbacks: ConnectionCallbacks,
    deps: ConnectionDeps = {},
  ) {
    this.wsFactory = deps.wsFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => window.clearTimeout(handle));
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = undefined;
  }

  currentSeq(): number {
    return this.lastSeq;
  }

  send<T extends ClientMsgType>(type: T, payload: ClientPayload<T>): string {
    this.msgCounter += 1;
    const id = `c-${String(this.msgCounter)}`;
    const msg = clientMsg(type, payload, id);
    if (this.ws?.readyState === 1) {
      this.ws.send(encodeClientMsg(msg));
    }
    return id;
  }

  private wsUrl(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.hash = '';
    if (this.credentials) {
      url.searchParams.set('device', this.credentials.deviceId);
      url.searchParams.set('credential', this.credentials.credential);
    }
    if (this.lastSeq > 0) url.searchParams.set('lastSeq', String(this.lastSeq));
    return url.toString();
  }

  private open(): void {
    if (this.stopped) return;
    let socket: WebSocketLike;
    try {
      socket = this.wsFactory(this.wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.lastHeardAt = this.now();
      this.callbacks.onState('connected');
      this.heartbeat();
    };
    socket.onmessage = (event) => {
      this.lastHeardAt = this.now();
      const decoded = decodeServerMsg(event.data);
      if (!decoded.ok) return;
      this.trackSeq(decoded.msg);
      if (decoded.msg.type === 'pong') {
        this.callbacks.onLatency(this.now() - decoded.msg.payload.t);
      }
      this.callbacks.onMsg(decoded.msg);
    };
    socket.onclose = () => {
      if (this.ws === socket) this.scheduleReconnect();
    };
    socket.onerror = () => {
      if (this.ws === socket) {
        socket.close();
      }
    };
  }

  private trackSeq(msg: ServerMsg): void {
    if (msg.type === 'hello') {
      this.lastSeq = Math.max(this.lastSeq, msg.payload.seq);
      return;
    }
    if (
      msg.type === 'session_upsert' ||
      msg.type === 'session_removed' ||
      msg.type === 'event' ||
      msg.type === 'permission_request' ||
      msg.type === 'permission_resolved'
    ) {
      this.lastSeq = Math.max(this.lastSeq, msg.seq);
    }
  }

  private heartbeat(): void {
    if (this.stopped || !this.ws) return;
    if (this.now() - this.lastHeardAt > DEAD_AFTER_MS) {
      const dead = this.ws;
      this.ws = undefined;
      dead.close();
      this.scheduleReconnect();
      return;
    }
    this.send('ping', { t: this.now() });
    this.heartbeatHandle = this.setTimer(() => {
      this.heartbeat();
    }, PING_INTERVAL_MS);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.clearTimers();
    this.ws = undefined;
    this.callbacks.onState('reconnecting');
    const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt);
    const delay = BACKOFF_MIN_MS + this.random() * Math.max(0, cap - BACKOFF_MIN_MS);
    this.attempt += 1;
    this.reconnectHandle = this.setTimer(() => {
      this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.heartbeatHandle !== undefined) {
      this.clearTimer(this.heartbeatHandle);
      this.heartbeatHandle = undefined;
    }
    if (this.reconnectHandle !== undefined) {
      this.clearTimer(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
  }
}
