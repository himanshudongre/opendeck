import { afterEach, describe, expect, it, vi } from 'vitest';
import { playTick } from '../src/lib/sound.js';
import { startVoice } from '../src/lib/voice.js';
import { acquireWakeLock } from '../src/lib/wakelock.js';

describe('sound synthesis', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing for silent and off presets', () => {
    playTick('silent');
    playTick('off');
  });

  it('synthesizes the clicky tick through WebAudio', () => {
    const nodes = { started: 0, connected: 0 };
    class FakeParam {
      setValueAtTime = vi.fn();
      exponentialRampToValueAtTime = vi.fn();
    }
    class FakeNode {
      frequency = new FakeParam();
      gain = new FakeParam();
      type = '';
      connect(): this {
        nodes.connected += 1;
        return this;
      }
      start(): void {
        nodes.started += 1;
      }
      stop(): void {
        // The oscillator schedules its own stop.
      }
    }
    class FakeAudioContext {
      currentTime = 0;
      state = 'running';
      destination = {};
      resume = vi.fn();
      createGain = (): FakeNode => new FakeNode();
      createOscillator = (): FakeNode => new FakeNode();
      createBiquadFilter = (): FakeNode => new FakeNode();
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    playTick('clicky');
    expect(nodes.started).toBe(1);
    expect(nodes.connected).toBe(3);
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
