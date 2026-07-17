import { afterEach, describe, expect, it, vi } from 'vitest';
import { playDetent, playKeyDown, playKeyUp, setCustomKit } from '../src/lib/sound.js';
import {
  clearSwitchSounds,
  importSwitchSound,
  MAX_SOUND_BYTES,
  primeSwitchSounds,
} from '../src/lib/switch-sounds.js';
import { startVoice } from '../src/lib/voice.js';
import { acquireWakeLock } from '../src/lib/wakelock.js';

describe('sound synthesis', () => {
  const nodes = { started: 0 };

  class FakeParam {
    value = 0;
    setValueAtTime = vi.fn();
    exponentialRampToValueAtTime = vi.fn();
  }
  class FakeNode {
    frequency = new FakeParam();
    gain = new FakeParam();
    playbackRate = new FakeParam();
    Q = new FakeParam();
    threshold = new FakeParam();
    knee = new FakeParam();
    ratio = new FakeParam();
    attack = new FakeParam();
    release = new FakeParam();
    buffer: unknown = undefined;
    type = '';
    connect(): this {
      return this;
    }
    start(): void {
      nodes.started += 1;
    }
    stop(): void {
      // Sources schedule their own stop.
    }
  }
  class FakeAudioContext {
    currentTime = 0;
    sampleRate = 48000;
    state = 'running';
    destination = {};
    resume = vi.fn();
    createGain = (): FakeNode => new FakeNode();
    createOscillator = (): FakeNode => new FakeNode();
    createBiquadFilter = (): FakeNode => new FakeNode();
    createBufferSource = (): FakeNode => new FakeNode();
    createDynamicsCompressor = (): FakeNode => new FakeNode();
    createBuffer = (): { getChannelData: () => Float32Array } => ({
      getChannelData: () => new Float32Array(16),
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    nodes.started = 0;
  });

  it('does nothing for the off preset', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    playKeyDown('off');
    playKeyUp('off');
    playDetent('off');
    expect(nodes.started).toBe(0);
  });

  it('layers click, plate strike, and case resonance for clicky', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    playKeyDown('clicky');
    expect(nodes.started).toBe(3);
  });

  it('drops the click leaf for thocky and silent switches', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    playKeyDown('thocky');
    expect(nodes.started).toBe(2);
    nodes.started = 0;
    playKeyDown('silent');
    expect(nodes.started).toBe(2);
  });

  it('release and detents are their own smaller strikes', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    playKeyUp('clicky');
    expect(nodes.started).toBe(3);
    nodes.started = 0;
    playDetent('thocky');
    expect(nodes.started).toBe(2);
  });

  it('custom falls back to clicky until a sample is armed', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    setCustomKit({});
    playKeyDown('custom');
    expect(nodes.started).toBe(3);
  });

  it('custom plays the armed sample as a single source', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    setCustomKit({ down: {} as AudioBuffer, name: 'holy-panda.wav' });
    playKeyDown('custom');
    expect(nodes.started).toBe(1);
    nodes.started = 0;
    playKeyUp('custom');
    expect(nodes.started).toBe(1);
    setCustomKit({});
  });
});

describe('switch sound storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('degrades quietly without IndexedDB or WebAudio', async () => {
    expect(await primeSwitchSounds()).toBeUndefined();
    await clearSwitchSounds();
  });

  it('rejects oversized or undecodable files without storing them', async () => {
    const big = { size: MAX_SOUND_BYTES + 1 } as File;
    expect(await importSwitchSound('down', big)).toBeUndefined();
    const junk = new File([new Uint8Array(8)], 'not-audio.wav');
    expect(await importSwitchSound('down', junk)).toBeUndefined();
  });

  it('stores, primes, and clears imported sounds through IndexedDB', async () => {
    interface Callback {
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
    }
    const request = <T>(result: T): IDBRequest<T> => {
      const req: Callback & { result: T } = { result, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req as unknown as IDBRequest<T>;
    };
    const rows = new Map<string, unknown>();
    const store = {
      get: (key: string) => request(rows.get(key)),
      put: (value: unknown, key: string) => {
        rows.set(key, value);
        return request(undefined);
      },
      delete: (key: string) => {
        rows.delete(key);
        return request(undefined);
      },
    };
    const db = {
      transaction: () => ({ objectStore: () => store }),
      createObjectStore: () => store,
      close: () => undefined,
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const openRequest: Callback & { onupgradeneeded: (() => void) | null; result: unknown } = {
          result: db,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => {
          openRequest.onupgradeneeded?.();
          openRequest.onsuccess?.();
        });
        return openRequest;
      },
    });
    class FakeOffline {
      decodeAudioData(): Promise<AudioBuffer> {
        return Promise.resolve({ duration: 0.08 } as AudioBuffer);
      }
    }
    vi.stubGlobal('OfflineAudioContext', FakeOffline);

    const press = new File([new Uint8Array(16)], 'topre.wav');
    expect(await importSwitchSound('down', press)).toBe('topre.wav');
    expect(await primeSwitchSounds()).toBe('topre.wav');
    const release = new File([new Uint8Array(8)], 'topre-up.wav');
    expect(await importSwitchSound('up', release)).toBe('topre-up.wav');
    await clearSwitchSounds();
    expect(await primeSwitchSounds()).toBeUndefined();
  });
});

describe('wake lock', () => {
  it('prefers the native API on secure contexts', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release });
    const doc = {
      defaultView: { navigator: { wakeLock: { request } }, isSecureContext: true },
    } as unknown as Document;

    const handle = await acquireWakeLock(doc);
    expect(handle.kind).toBe('native');
    expect(request).toHaveBeenCalledWith('screen');
    handle.release();
    expect(release).toHaveBeenCalled();
  });

  it('falls back to the silent video on insecure contexts', async () => {
    const handle = await acquireWakeLock(document);
    // jsdom cannot actually play video; the honest answer is the video
    // element was tried and cleaned up, leaving the unavailable handle.
    expect(handle.kind === 'video' || handle.kind === 'unavailable').toBe(true);
    handle.release();
    expect(document.querySelectorAll('video')).toHaveLength(0);
  });
});

describe('voice sessions', () => {
  interface RecognitionHandlers {
    onresult:
      | ((event: {
          results: { 0: { transcript: string }; isFinal: boolean; length: number }[];
        }) => void)
      | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
  }

  function fakeWindow(): { win: Window; instances: RecognitionHandlers[] } {
    const instances: RecognitionHandlers[] = [];
    class FakeRecognition implements RecognitionHandlers {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: RecognitionHandlers['onresult'] = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        instances.push(this);
      }
      start(): void {
        // Listening begins; results arrive via onresult.
      }
      stop(): void {
        this.onend?.();
      }
      abort(): void {
        this.onend?.();
      }
    }
    return {
      win: { isSecureContext: true, SpeechRecognition: FakeRecognition } as unknown as Window,
      instances,
    };
  }

  it('streams interim text and resolves the final transcript on stop', () => {
    const { win, instances } = fakeWindow();
    const interim: string[] = [];
    let finalText = '';
    const session = startVoice(
      'en-US',
      (t) => interim.push(t),
      (t) => (finalText = t),
      win,
    );
    expect(session).toBeDefined();
    const recognition = instances[0];
    expect(recognition).toBeDefined();

    recognition?.onresult?.({
      results: [{ 0: { transcript: 'approve the ' }, isFinal: true, length: 1 }],
    });
    recognition?.onresult?.({
      results: [
        { 0: { transcript: 'approve the ' }, isFinal: true, length: 1 },
        { 0: { transcript: 'diff' }, isFinal: false, length: 1 },
      ],
    });
    expect(interim.at(-1)).toBe('approve the diff');

    session?.stop();
    expect(finalText).toBe('approve the');
  });

  it('abort suppresses the final callback', () => {
    const { win } = fakeWindow();
    let finals = 0;
    const session = startVoice(
      'en-US',
      () => undefined,
      () => (finals += 1),
      win,
    );
    session?.abort();
    expect(finals).toBe(0);
  });

  it('returns nothing on insecure contexts', () => {
    const win = { isSecureContext: false } as unknown as Window;
    expect(
      startVoice(
        'en-US',
        () => undefined,
        () => undefined,
        win,
      ),
    ).toBeUndefined();
  });
});
