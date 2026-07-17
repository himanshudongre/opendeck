import { describe, expect, it, vi } from 'vitest';
import { createCoalescer } from '../src/lib/coalescer.js';
import {
  formatCost,
  formatElapsed,
  formatLatency,
  formatTokens,
  statusLabel,
} from '../src/lib/format.js';
import { hapticTick } from '../src/lib/haptics.js';
import {
  deviceName,
  pairWithToken,
  pairingTokenFromHash,
  readPairing,
  savePairing,
  clearPairing,
} from '../src/lib/pairing.js';
import { voiceAvailability } from '../src/lib/voice.js';

describe('format helpers', () => {
  it('formats elapsed time with and without hours', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(61_000)).toBe('1:01');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(-5)).toBe('0:00');
  });

  it('formats token counts into k/M', () => {
    expect(formatTokens(840)).toBe('840');
    expect(formatTokens(4_120)).toBe('4.1k');
    expect(formatTokens(41_200)).toBe('41k');
    expect(formatTokens(1_300_000)).toBe('1.3M');
  });

  it('keeps sub-cent costs honest', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0.31)).toBe('$0.31');
  });

  it('formats latency and status labels', () => {
    expect(formatLatency(undefined)).toBe('— ms');
    expect(formatLatency(11.6)).toBe('12 ms');
    expect(statusLabel('waiting_permission')).toBe('needs approval');
    expect(statusLabel('mystery')).toBe('mystery');
  });
});

describe('coalescer', () => {
  it('sends one message per frame carrying only the latest value', () => {
    const sent: number[] = [];
    let frame: (() => void) | undefined;
    const coalescer = createCoalescer<number>(
      (value) => sent.push(value),
      (cb) => {
        frame = cb;
        return 1;
      },
      () => undefined,
    );

    coalescer.push(1);
    coalescer.push(2);
    coalescer.push(3);
    expect(sent).toEqual([]);
    frame?.();
    expect(sent).toEqual([3]);
  });

  it('flush sends immediately and cancel drops pending values', () => {
    const sent: number[] = [];
    const cancelled: number[] = [];
    const coalescer = createCoalescer<number>(
      (value) => sent.push(value),
      () => 7,
      (handle) => cancelled.push(handle),
    );

    coalescer.push(4);
    coalescer.flush();
    expect(sent).toEqual([4]);
    expect(cancelled).toEqual([7]);

    coalescer.push(5);
    coalescer.cancel();
    coalescer.flush();
    expect(sent).toEqual([4]);
  });
});

describe('haptics', () => {
  it('vibrates only when enabled and supported', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    hapticTick(false);
    expect(vibrate).not.toHaveBeenCalled();
    hapticTick(true, 12);
    expect(vibrate).toHaveBeenCalledWith(12);
  });
});

describe('pairing', () => {
  it('parses tokens from the QR hash', () => {
    expect(pairingTokenFromHash('#pair=abc_DEF-123')).toBe('abc_DEF-123');
    expect(pairingTokenFromHash('#other')).toBeUndefined();
    expect(pairingTokenFromHash('')).toBeUndefined();
  });

  it('names devices from user agents', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('iPad');
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile')).toBe('Android phone');
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Tab S9)')).toBe('Android tablet');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('Mac browser');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows browser');
    expect(deviceName('curl/8')).toBe('Browser');
  });

  it('stores credentials only when pairing succeeds', async () => {
    const okFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ deviceId: 'device-1', credential: 'secret', hubId: 'hub-1' }),
          { status: 200 },
        ),
      );
    const result = await pairWithToken('http://hub.local:3325', 'token-1', 'iPad', okFetch);
    expect(result.ok).toBe(true);
    expect(readPairing()?.deviceId).toBe('device-1');

    clearPairing();
    const badFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Pairing token is invalid or expired.' }), {
        status: 403,
      }),
    );
    const failed = await pairWithToken('http://hub.local:3325', 'stale', 'iPad', badFetch);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.message).toContain('invalid or expired');
    expect(readPairing()).toBeUndefined();

    const downFetch = vi.fn().mockRejectedValue(new Error('refused'));
    const down = await pairWithToken('http://hub.local:3325', 't', 'iPad', downFetch);
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.message).toContain('Is it still running?');
  });

  it('round-trips and validates stored pairing', () => {
    savePairing({ deviceId: 'd', credential: 'c', hubId: 'h' });
    expect(readPairing()).toEqual({ deviceId: 'd', credential: 'c', hubId: 'h' });
    localStorage.setItem('agentdeck.pairing', '{"deviceId": 1}');
    expect(readPairing()).toBeUndefined();
    localStorage.setItem('agentdeck.pairing', 'not json');
    expect(readPairing()).toBeUndefined();
  });
});

describe('voice availability', () => {
  it('reports insecure contexts and missing APIs', () => {
    const insecure = { isSecureContext: false } as unknown as Window;
    expect(voiceAvailability(insecure)).toBe('insecure_context');
    const secureNoApi = { isSecureContext: true } as unknown as Window;
    expect(voiceAvailability(secureNoApi)).toBe('unsupported');
    const secureWithApi = {
      isSecureContext: true,
      SpeechRecognition: class {
        lang = '';
      },
    } as unknown as Window;
    expect(voiceAvailability(secureWithApi)).toBe('available');
  });
});
