import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controller } from '../src/lib/controller.js';
import { savePairing } from '../src/lib/pairing.js';
import { useDeck } from '../src/state/store.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
}

beforeEach(() => {
  useDeck.getState().reset();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  controller.unpair();
  vi.unstubAllGlobals();
});

describe('controller', () => {
  it('boots to unpaired when the hub requires pairing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Unknown device.' }), { status: 401 }),
        ),
    );
    await controller.init();
    expect(useDeck.getState().connection).toBe('unpaired');
  });

  it('connects without credentials when the hub runs --no-auth', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ sessions: [], seq: 0 }), { status: 200 })),
    );
    await controller.init();
    expect(useDeck.getState().connection).toBe('reconnecting');
    expect(FakeWebSocket.instances[0]?.url).not.toContain('device=');
  });

  it('connects with stored credentials and sends deck messages', async () => {
    savePairing({ deviceId: 'device-1', credential: 'secret', hubId: 'hub-1' });
    await controller.init();
    expect(useDeck.getState().connection).toBe('reconnecting');
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    expect(socket?.url).toContain('device=device-1');

    socket?.onopen?.();
    expect(useDeck.getState().connection).toBe('connected');

    controller.action({ kind: 'interrupt', sessionId: 's1' });
    controller.respondPermission('perm-1', 'approve');
    controller.prompt('s1', 'run tests');
    controller.voicePrompt('s1', 'review diff', 'en-US');
    controller.setEffort({ sessionId: 's1', axis: 'model', value: 'opus' });
    controller.subscribe('s1');

    const kinds = (socket?.sent ?? []).map((raw) => (JSON.parse(raw) as { type: string }).type);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'ping',
        'action',
        'permission_response',
        'prompt',
        'voice_prompt',
        'set_effort',
        'subscribe',
      ]),
    );
  });

  it('pairs from a QR hash token and scrubs the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deviceId: 'device-9', credential: 'c9', hubId: 'hub-9' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '#pair=tok-123';

    await controller.init();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/pair'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(window.location.hash).toBe('');
    expect(FakeWebSocket.instances[0]?.url).toContain('device=device-9');
  });

  it('reports failed pairing as an unpaired state with the reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Pairing token is invalid or expired.' }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '#pair=stale';

    await controller.init();
    expect(useDeck.getState().connection).toBe('unpaired');
    expect(useDeck.getState().ticker.at(-1)?.text).toContain('invalid or expired');
  });

  it('unpair clears credentials and resets the fleet', async () => {
    savePairing({ deviceId: 'device-1', credential: 'secret', hubId: 'hub-1' });
    await controller.init();
    controller.unpair();
    expect(useDeck.getState().connection).toBe('unpaired');
    expect(localStorage.getItem('opendeck.pairing')).toBeNull();
  });
});
