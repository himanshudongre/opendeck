import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { clientMsg, decodeServerMsg, encodeClientMsg, type ServerMsg } from '@agentdeck/protocol';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubConfigSchema } from '../src/config.js';
import { loadOrCreateCert } from '../src/server/certs.js';
import { lanAddresses, mdnsName } from '../src/server/net.js';
import { runShellAction } from '../src/server/shell.js';
import { isOriginAllowed } from '../src/server/ws.js';
import { startHub, type RunningHub } from '../src/server/start.js';
import { makeSession, tempHome } from './helpers.js';

let restoreHome: () => void;
let running: RunningHub;

beforeEach(async () => {
  restoreHome = tempHome();
  running = await startHub({
    config: HubConfigSchema.parse({}),
    version: '1.0.0-test',
    port: 0,
    localhostOnly: true,
    httpsLane: false,
  });
});

afterEach(async () => {
  await running.close();
  restoreHome();
});

function base(): string {
  return `http://127.0.0.1:${running.port}`;
}

async function pair(name = 'Test phone'): Promise<{ deviceId: string; credential: string }> {
  const token = running.pairing.issueToken();
  const res = await fetch(`${base()}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { deviceId: string; credential: string };
}

interface SocketHandle {
  ws: WebSocket;
  received: ServerMsg[];
  next: (predicate?: (msg: ServerMsg) => boolean) => Promise<ServerMsg>;
  close: () => void;
}

function connect(query: Record<string, string>): Promise<SocketHandle> {
  const params = new URLSearchParams(query).toString();
  const ws = new WebSocket(`ws://127.0.0.1:${running.port}/ws?${params}`);
  const received: ServerMsg[] = [];
  const waiters: { predicate: (msg: ServerMsg) => boolean; resolve: (msg: ServerMsg) => void }[] =
    [];

  ws.on('message', (data: Buffer) => {
    const decoded = decodeServerMsg(data.toString('utf8'));
    if (!decoded.ok) throw new Error(`hub sent an undecodable message: ${decoded.message}`);
    received.push(decoded.msg);
    const index = waiters.findIndex((w) => w.predicate(decoded.msg));
    if (index !== -1) {
      const [waiter] = waiters.splice(index, 1);
      waiter?.resolve(decoded.msg);
    }
  });

  const handle: SocketHandle = {
    ws,
    received,
    next: (predicate = () => true) => {
      const already = received.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise<ServerMsg>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for message')), 4000);
        waiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    },
    close: () => ws.terminate(),
  };

  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(handle));
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`ws rejected: ${res.statusCode}`)),
    );
    ws.once('error', reject);
  });
}

describe('REST', () => {
  it('serves health without auth', async () => {
    const res = await fetch(`${base()}/api/health`);
    const body = (await res.json()) as { ok: boolean; protocolVersion: number };
    expect(body.ok).toBe(true);
    expect(body.protocolVersion).toBe(1);
  });

  it('pairs once per token and rejects reuse', async () => {
    const token = running.pairing.issueToken();
    const first = await fetch(`${base()}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: 'iPad' }),
    });
    expect(first.status).toBe(200);

    const reuse = await fetch(`${base()}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: 'iPad again' }),
    });
    expect(reuse.status).toBe(403);
  });

  it('rejects malformed pairing bodies', async () => {
    const res = await fetch(`${base()}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it('rate-limits pairing attempts', async () => {
    let sawTooMany = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await fetch(`${base()}/api/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: `guess-${i}`, name: 'attacker' }),
      });
      if (res.status === 429) sawTooMany = true;
    }
    expect(sawTooMany).toBe(true);
  });

  it('guards the snapshot behind device credentials', async () => {
    const unauthorized = await fetch(`${base()}/api/snapshot`);
    expect(unauthorized.status).toBe(401);

    const creds = await pair();
    const authorized = await fetch(`${base()}/api/snapshot`, {
      headers: {
        'x-agentdeck-device': creds.deviceId,
        'x-agentdeck-credential': creds.credential,
      },
    });
    expect(authorized.status).toBe(200);
    const body = (await authorized.json()) as { sessions: unknown[]; seq: number };
    expect(body.sessions).toEqual([]);
  });

  it('serves the missing-deck page when no deck build exists', async () => {
    const res = await fetch(base());
    const html = await res.text();
    expect(html).toContain('Deck assets not found');
  });
});

describe('WebSocket', () => {
  it('rejects unauthenticated connections', async () => {
    await expect(connect({})).rejects.toThrow('401');
  });

  it('sends a fresh hello to a new client and fans out live events', async () => {
    const creds = await pair();
    const socket = await connect({ device: creds.deviceId, credential: creds.credential });

    const hello = await socket.next((m) => m.type === 'hello');
    if (hello.type === 'hello') {
      expect(hello.payload.resume).toBe('fresh');
      expect(hello.payload.hubVersion).toBe('1.0.0-test');
    }

    running.hub.upsertSession(makeSession(), {});
    const upsert = await socket.next((m) => m.type === 'session_upsert');
    if (upsert.type === 'session_upsert') expect(upsert.payload.id).toBe('sess-1');
    socket.close();
  });

  it('answers ping with pong echoing the timestamp', async () => {
    const creds = await pair();
    const socket = await connect({ device: creds.deviceId, credential: creds.credential });
    socket.ws.send(encodeClientMsg(clientMsg('ping', { t: 12345 }, 'c-ping')));
    const pong = await socket.next((m) => m.type === 'pong');
    if (pong.type === 'pong') expect(pong.payload.t).toBe(12345);
    socket.close();
  });

  it('resumes after a dropped socket with zero missed events', async () => {
    const creds = await pair();
    const first = await connect({ device: creds.deviceId, credential: creds.credential });
    await first.next((m) => m.type === 'hello');

    running.hub.upsertSession(makeSession(), {});
    const upsert = await first.next((m) => m.type === 'session_upsert');
    const lastSeq = upsert.seq;

    // The network dies mid-scenario; events keep happening.
    first.close();
    running.hub.setStatus('sess-1', 'waiting_permission');
    running.hub.notice('sess-1', 'info', 'still running');

    const second = await connect({
      device: creds.deviceId,
      credential: creds.credential,
      lastSeq: String(lastSeq),
    });
    const hello = await second.next((m) => m.type === 'hello');
    if (hello.type === 'hello') expect(hello.payload.resume).toBe('resumed');

    await second.next(
      (m) =>
        m.type === 'event' &&
        m.payload.kind === 'status' &&
        m.payload.status === 'waiting_permission',
    );
    await second.next((m) => m.type === 'event' && m.payload.kind === 'notice');
    const replayedSeqs = second.received.filter((m) => m.type === 'event').map((m) => m.seq);
    expect(replayedSeqs).toEqual([lastSeq + 1, lastSeq + 2]);
    second.close();
  });

  it('falls back to a snapshot hello when the gap outgrew the buffer', async () => {
    await running.close();
    running = await startHub({
      config: HubConfigSchema.parse({ auth: false }),
      version: '1.0.0-test',
      port: 0,
      localhostOnly: true,
      httpsLane: false,
      noAuth: true,
    });
    running.hub.upsertSession(makeSession(), {});
    // Small buffers are a Hub option, but the running hub uses 1000: overflow it.
    for (let i = 0; i < 1100; i += 1) running.hub.notice('sess-1', 'info', `tick ${i}`);

    const socket = await connect({ lastSeq: '1' });
    const hello = await socket.next((m) => m.type === 'hello');
    if (hello.type === 'hello') {
      expect(hello.payload.resume).toBe('snapshot');
      expect(hello.payload.sessions).toHaveLength(1);
    }
    socket.close();
  });

  it('streams transcripts only to subscribed clients', async () => {
    await running.close();
    running = await startHub({
      config: HubConfigSchema.parse({}),
      version: '1.0.0-test',
      port: 0,
      localhostOnly: true,
      httpsLane: false,
      noAuth: true,
    });
    running.hub.upsertSession(makeSession(), {});

    const grid = await connect({});
    const focus = await connect({});
    focus.ws.send(encodeClientMsg(clientMsg('subscribe', { sessionId: 'sess-1' }, 'c-sub')));
    await focus.next((m) => m.type === 'ack');

    running.hub.transcript('sess-1', 'assistant', 'Rewriting the retry loop…', false);
    running.hub.notice('sess-1', 'info', 'visible to everyone');

    await focus.next((m) => m.type === 'event' && m.payload.kind === 'transcript');
    await grid.next((m) => m.type === 'event' && m.payload.kind === 'notice');
    expect(grid.received.some((m) => m.type === 'event' && m.payload.kind === 'transcript')).toBe(
      false,
    );
    grid.close();
    focus.close();
  });

  it('acks dispatched messages and reports errors with the client id', async () => {
    const creds = await pair();
    const socket = await connect({ device: creds.deviceId, credential: creds.credential });

    socket.ws.send(
      encodeClientMsg(clientMsg('prompt', { sessionId: 'ghost', text: 'hello' }, 'c-err')),
    );
    const err = await socket.next((m) => m.type === 'error');
    if (err.type === 'error') {
      expect(err.payload.code).toBe('unknown_session');
      expect(err.payload.id).toBe('c-err');
    }

    socket.ws.send('not json at all');
    const bad = await socket.next((m) => m.type === 'error' && m.payload.code === 'bad_message');
    expect(bad.type).toBe('error');
    socket.close();
  });
});

describe('deck asset serving', () => {
  it('serves the built deck with an SPA fallback', async () => {
    await running.close();
    const deckDir = join(process.env.AGENTDECK_HOME ?? '', 'deck-dist');
    mkdirSync(deckDir, { recursive: true });
    writeFileSync(join(deckDir, 'index.html'), '<!doctype html><title>AgentDeck</title>');
    const paired: string[] = [];
    running = await startHub({
      config: HubConfigSchema.parse({}),
      version: '1.0.0-test',
      port: 0,
      localhostOnly: true,
      httpsLane: false,
      deckDir,
      onPaired: (name) => paired.push(name),
    });

    const index = await (await fetch(base())).text();
    expect(index).toContain('AgentDeck');
    const spa = await fetch(`${base()}/settings/themes`);
    expect(await spa.text()).toContain('AgentDeck');
    const api = await fetch(`${base()}/api/missing`);
    expect(api.status).toBe(404);

    await pair('Living room iPad');
    expect(paired).toEqual(['Living room iPad']);
  });
});

describe('https lane', () => {
  it('serves the same api over the self-signed cert', async () => {
    await running.close();
    running = await startHub({
      config: HubConfigSchema.parse({}),
      version: '1.0.0-test',
      port: 0,
      httpsPort: 0,
      localhostOnly: true,
      httpsLane: true,
    });
    expect(running.httpsPort).toBeDefined();

    const status = await new Promise<number>((resolve, reject) => {
      const req = httpsRequest(
        {
          host: '127.0.0.1',
          port: running.httpsPort,
          path: '/api/health',
          rejectUnauthorized: false,
        },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(200);
  }, 15_000);
});

describe('websocket edge cases', () => {
  it('rejects cross-origin upgrades', async () => {
    const creds = await pair();
    const params = new URLSearchParams({
      device: creds.deviceId,
      credential: creds.credential,
    }).toString();
    const ws = new WebSocket(`ws://127.0.0.1:${running.port}/ws?${params}`, {
      origin: 'http://evil.example',
    });
    const outcome = await new Promise<string>((resolve) => {
      ws.once('unexpected-response', (_req, res) => resolve(`status-${res.statusCode}`));
      ws.once('open', () => resolve('open'));
      ws.once('error', (error) => resolve(error.message));
    });
    expect(outcome).toContain('403');
  });

  it('destroys upgrades for unknown paths', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${running.port}/not-ws`);
    const outcome = await new Promise<string>((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('error', () => resolve('destroyed'));
    });
    expect(outcome).toBe('destroyed');
  });

  it('reports protocol version mismatches to the client', async () => {
    const creds = await pair();
    const socket = await connect({ device: creds.deviceId, credential: creds.credential });
    socket.ws.send(JSON.stringify({ v: 99, id: 'c-x', type: 'ping', payload: { t: 1 } }));
    const err = await socket.next(
      (m) => m.type === 'error' && m.payload.code === 'version_mismatch',
    );
    if (err.type === 'error') expect(err.payload.message).toContain('npx agent-deck@latest');
    socket.close();
  });

  it('re-syncs on a mid-connection resume message', async () => {
    const creds = await pair();
    const socket = await connect({ device: creds.deviceId, credential: creds.credential });
    await socket.next((m) => m.type === 'hello');

    running.hub.upsertSession(makeSession(), {});
    const upsert = await socket.next((m) => m.type === 'session_upsert');

    socket.ws.send(encodeClientMsg(clientMsg('resume', { lastSeq: upsert.seq - 1 }, 'c-r')));
    const hello = await socket.next((m) => m.type === 'hello' && m.payload.resume === 'resumed');
    expect(hello.type).toBe('hello');
    socket.close();
  });
});

describe('bind configuration', () => {
  it('honors bind: localhost from config.json', async () => {
    await running.close();
    running = await startHub({
      config: HubConfigSchema.parse({ bind: 'localhost' }),
      version: '1.0.0-test',
      port: 0,
      httpsLane: false,
    });
    expect(running.host).toBe('127.0.0.1');
    const res = await fetch(`${base()}/api/health`);
    expect(res.status).toBe(200);
  });
});

describe('claude hooks route', () => {
  it('accepts loopback hook posts and creates observed sessions', async () => {
    const res = await fetch(`${base()}/api/hooks/claude`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: 'terminal-1',
        transcript_path: '/tmp/t.jsonl',
        cwd: '/home/dev/acme/api',
        hook_event_name: 'SessionStart',
        source: 'startup',
      }),
    });
    expect(res.status).toBe(204);
    const session = running.hub.snapshot().find((s) => s.id === 'claude-obs-terminal-1');
    expect(session?.mode).toBe('observed');
  });

  it('rejects new_session actions for unknown harnesses', async () => {
    const result = await running.hub.dispatch({
      v: 1,
      id: 'c-ns',
      type: 'action',
      payload: { kind: 'new_session', args: { harness: 'opencode' } },
    });
    expect(result.ok).toBe(false);
  });
});

describe('origin policy', () => {
  it('accepts same-host, dev-listed, and non-browser origins; rejects the rest', () => {
    expect(isOriginAllowed(undefined, 'studio.local:3325')).toBe(true);
    expect(isOriginAllowed('http://studio.local:3325', 'studio.local:3325')).toBe(true);
    expect(isOriginAllowed('https://studio.local:3326', 'studio.local:3325')).toBe(true);
    expect(
      isOriginAllowed('http://localhost:5173', 'studio.local:3325', ['http://localhost:5173']),
    ).toBe(true);
    expect(isOriginAllowed('http://evil.example', 'studio.local:3325')).toBe(false);
    expect(isOriginAllowed('file://local', 'studio.local:3325')).toBe(false);
    expect(isOriginAllowed('garbage', 'studio.local:3325')).toBe(false);
    expect(isOriginAllowed('http://studio.local:3325', undefined)).toBe(false);
  });
});

describe('helpers', () => {
  it('generates a cert once and reuses it', async () => {
    const first = await loadOrCreateCert(['192.168.1.24']);
    expect(first.cert).toContain('BEGIN CERTIFICATE');
    const second = await loadOrCreateCert([]);
    expect(second.cert).toBe(first.cert);
  });

  it('reports lan addresses and an mdns name', () => {
    expect(Array.isArray(lanAddresses())).toBe(true);
    expect(mdnsName()).toMatch(/\.local$/);
  });

  it('runs shell actions and captures failures', async () => {
    const ok = await runShellAction({ id: 'echo', label: 'Echo', command: 'echo hub-test' });
    expect(ok.ok).toBe(true);
    expect(ok.output).toContain('hub-test');

    const bad = await runShellAction({ id: 'bad', label: 'Bad', command: 'exit 3' });
    expect(bad.ok).toBe(false);
  });
});
