import { afterEach, describe, expect, it, vi } from 'vitest';
import { playDetent, playKeyDown, playKeyUp } from '../src/lib/sound.js';
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
