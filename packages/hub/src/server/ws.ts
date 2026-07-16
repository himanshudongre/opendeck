import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { decodeClientMsg, encodeServerMsg, serverMsg, type ServerMsg } from '@agentdeck/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Hub } from '../core/hub.js';
import { logger } from '../logger.js';
import type { DeviceStore } from './auth.js';

export const HEARTBEAT_TIMEOUT_MS = 12_000;
export const HEARTBEAT_SWEEP_MS = 5_000;

export interface WsDeps {
  hub: Hub;
  devices: DeviceStore;
  authRequired: boolean;
  /** Extra origins to accept (the Vite dev server during development). */
  extraOrigins?: string[];
}

interface ClientConn {
  ws: WebSocket;
  deviceId: string | undefined;
  /** Session whose transcript this client streams; null = grid only. */
  transcriptSessionId: string | null;
  lastSeenAt: number;
}

/**
 * Same-host origin policy: browser connections must come from a page the hub
 * itself served (any port — the deck may sit on the HTTP or HTTPS lane) or an
 * explicitly allowed dev origin. Non-browser clients send no Origin and pass.
 */
export function isOriginAllowed(
  origin: string | undefined,
  requestHost: string | undefined,
  extraOrigins: string[] = [],
): boolean {
  if (origin === undefined || origin === '') return true;
  if (extraOrigins.includes(origin)) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const requestHostname = requestHost?.split(':')[0];
  return requestHostname !== undefined && parsed.hostname === requestHostname;
}

export function attachWs(server: HttpServer | HttpsServer, deps: WsDeps): WebSocketServer {
  const log = logger().child({ component: 'ws' });
  const wss = new WebSocketServer({ noServer: true });
  const conns = new Set<ClientConn>();

  const sweep = setInterval(() => {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    for (const conn of conns) {
      if (conn.lastSeenAt < cutoff) {
        log.info({ deviceId: conn.deviceId }, 'client heartbeat timed out');
        conn.ws.terminate();
      }
    }
  }, HEARTBEAT_SWEEP_MS);
  sweep.unref();

  const send = (conn: ClientConn, msg: ServerMsg): void => {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(encodeServerMsg(msg));
  };

  deps.hub.bus.on('broadcast', (msg) => {
    for (const conn of conns) {
      if (
        msg.type === 'event' &&
        msg.payload.kind === 'transcript' &&
        conn.transcriptSessionId !== msg.payload.sessionId
      ) {
        continue;
      }
      send(conn, msg);
    }
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isOriginAllowed(req.headers.origin, req.headers.host, deps.extraOrigins)) {
      log.warn({ origin: req.headers.origin }, 'rejected cross-origin websocket');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    let deviceId: string | undefined;
    if (deps.authRequired) {
      const id = url.searchParams.get('device');
      const credential = url.searchParams.get('credential');
      const device =
        id !== null && credential !== null ? deps.devices.authenticate(id, credential) : undefined;
      if (!device) {
        log.warn({ deviceId: id }, 'rejected unauthenticated websocket');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      deviceId = device.id;
    }

    const lastSeqParam = url.searchParams.get('lastSeq');
    const lastSeq = lastSeqParam === null ? undefined : Number.parseInt(lastSeqParam, 10);

    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn: ClientConn = { ws, deviceId, transcriptSessionId: null, lastSeenAt: Date.now() };
      conns.add(conn);
      deps.hub.clientConnected();
      greet(conn, lastSeq);

      ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        conn.lastSeenAt = Date.now();
        handleMessage(conn, data);
      });
      ws.on('close', () => {
        if (conns.delete(conn)) deps.hub.clientDisconnected();
      });
      ws.on('error', (error) => log.warn({ err: error }, 'websocket error'));
    });
  });

  function greet(conn: ClientConn, lastSeq: number | undefined): void {
    if (lastSeq === undefined || Number.isNaN(lastSeq)) {
      send(conn, serverMsg('hello', deps.hub.helloPayload('fresh'), deps.hub.currentSeq()));
      return;
    }
    const replay = deps.hub.replaySince(lastSeq);
    if (replay === undefined) {
      send(conn, serverMsg('hello', deps.hub.helloPayload('snapshot'), deps.hub.currentSeq()));
      return;
    }
    send(conn, serverMsg('hello', deps.hub.helloPayload('resumed'), deps.hub.currentSeq()));
    for (const msg of replay) send(conn, msg);
  }

  function handleMessage(conn: ClientConn, data: Buffer | ArrayBuffer | Buffer[]): void {
    const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    const decoded = decodeClientMsg(raw.toString('utf8'));
    if (!decoded.ok) {
      const code = decoded.reason === 'version_mismatch' ? 'version_mismatch' : 'bad_message';
      send(conn, serverMsg('error', { code, message: decoded.message }, deps.hub.currentSeq()));
      return;
    }
    const msg = decoded.msg;

    switch (msg.type) {
      case 'ping':
        send(conn, serverMsg('pong', { t: msg.payload.t }, deps.hub.currentSeq()));
        return;
      case 'subscribe':
        conn.transcriptSessionId = msg.payload.sessionId;
        send(conn, serverMsg('ack', { id: msg.id }, deps.hub.currentSeq()));
        return;
      case 'resume':
        greet(conn, msg.payload.lastSeq);
        return;
      default:
        void dispatch(conn, msg);
    }
  }

  async function dispatch(conn: ClientConn, msg: Parameters<Hub['dispatch']>[0]): Promise<void> {
    try {
      const result = await deps.hub.dispatch(msg);
      if (result.ok) {
        send(
          conn,
          serverMsg(
            'ack',
            result.data ? { id: msg.id, data: result.data } : { id: msg.id },
            deps.hub.currentSeq(),
          ),
        );
      } else {
        send(
          conn,
          serverMsg(
            'error',
            { code: result.code, message: result.message, id: msg.id },
            deps.hub.currentSeq(),
          ),
        );
      }
    } catch (error) {
      log.error({ err: error, msgType: msg.type }, 'dispatch failed');
      send(
        conn,
        serverMsg(
          'error',
          {
            code: 'internal',
            message: 'Something failed inside the hub. Check the hub logs.',
            id: msg.id,
          },
          deps.hub.currentSeq(),
        ),
      );
    }
  }

  wss.on('close', () => clearInterval(sweep));
  return wss;
}
