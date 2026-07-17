/**
 * WebAudio-synthesized switch acoustics. A real key press is three sounds
 * layered: the tactile click of the leaf, the broadband slap of the cap
 * hitting the plate, and the low resonance of the case. Release is the same
 * event smaller and brighter. Everything is generated at press time — no
 * audio assets — and every strike is randomly detuned a few percent so rapid
 * typing never sounds like a sample played on repeat.
 *
 * Presets mirror the switch families the hardware sells: `clicky` (crisp
 * click jacket), `thocky` (deep lubed-linear bottom-out), `silent`
 * (dampened stems, barely-there), `off`.
 */
export type SoundPreset = 'clicky' | 'thocky' | 'silent' | 'off';

let context: AudioContext | undefined;
let master: DynamicsCompressorNode | undefined;
let noiseBuffer: AudioBuffer | undefined;

function graph(): { ctx: AudioContext; out: AudioNode; noise: AudioBuffer } | undefined {
  if (typeof AudioContext === 'undefined') return undefined;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  if (!master) {
    // A gentle compressor keeps six-finger rolls from clipping into fizz.
    master = context.createDynamicsCompressor();
    master.threshold.value = -18;
    master.knee.value = 12;
    master.ratio.value = 6;
    master.attack.value = 0.001;
    master.release.value = 0.08;
    master.connect(context.destination);
  }
  if (!noiseBuffer) {
    const length = Math.floor(context.sampleRate * 0.12);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return { ctx: context, out: master, noise: noiseBuffer };
}

/** ±spread multiplicative jitter, e.g. drift(0.06) is up to ±6%. */
function drift(spread: number): number {
  return 1 + (Math.random() * 2 - 1) * spread;
}

interface Burst {
  freq: number;
  q: number;
  gain: number;
  decay: number;
}

/** Bandpass-filtered noise: the cap striking the plate (or the click leaf). */
function strike(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, at: number, b: Burst): void {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = b.freq * drift(0.08);
  filter.Q.value = b.q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(b.gain * drift(0.2), at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + b.decay);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(at);
  source.stop(at + b.decay + 0.01);
}

/** A decaying sine: the case ringing after bottom-out — the "thock" itself. */
function resonance(
  ctx: AudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  gain: number,
  decay: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const f = freq * drift(0.05);
  osc.frequency.setValueAtTime(f * 1.3, at);
  osc.frequency.exponentialRampToValueAtTime(f, at + 0.02);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain * drift(0.15), at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(env);
  env.connect(out);
  osc.start(at);
  osc.stop(at + decay + 0.01);
}

interface Voice {
  click?: Burst;
  plate: Burst;
  body: { freq: number; gain: number; decay: number };
}

const DOWN: Record<Exclude<SoundPreset, 'off'>, Voice> = {
  clicky: {
    click: { freq: 3900, q: 9, gain: 0.16, decay: 0.012 },
    plate: { freq: 1500, q: 2.2, gain: 0.13, decay: 0.03 },
    body: { freq: 150, gain: 0.09, decay: 0.07 },
  },
  thocky: {
    plate: { freq: 850, q: 1.4, gain: 0.12, decay: 0.035 },
    body: { freq: 98, gain: 0.17, decay: 0.11 },
  },
  silent: {
    plate: { freq: 650, q: 1, gain: 0.045, decay: 0.02 },
    body: { freq: 120, gain: 0.035, decay: 0.05 },
  },
};

function play(preset: SoundPreset, scale: number, brighten: number): void {
  if (preset === 'off') return;
  const g = graph();
  if (!g) return;
  const voice = DOWN[preset];
  const at = g.ctx.currentTime;
  if (voice.click) {
    strike(g.ctx, g.out, g.noise, at, {
      ...voice.click,
      freq: voice.click.freq * brighten,
      gain: voice.click.gain * scale,
    });
  }
  strike(g.ctx, g.out, g.noise, at + 0.004, {
    ...voice.plate,
    freq: voice.plate.freq * brighten,
    gain: voice.plate.gain * scale,
  });
  resonance(
    g.ctx,
    g.out,
    at + 0.006,
    voice.body.freq * brighten,
    voice.body.gain * scale,
    voice.body.decay,
  );
}

/** Bottom-out: the full three-layer strike. */
export function playKeyDown(preset: SoundPreset): void {
  play(preset, 1, 1);
}

/** Release: the same switch, smaller and a shade brighter. */
export function playKeyUp(preset: SoundPreset): void {
  play(preset, 0.45, 1.3);
}

/** One rotary-encoder detent: a short dry tick, no case resonance. */
export function playDetent(preset: SoundPreset): void {
  if (preset === 'off') return;
  const g = graph();
  if (!g) return;
  const at = g.ctx.currentTime;
  strike(g.ctx, g.out, g.noise, at, { freq: 2700, q: 5, gain: 0.07, decay: 0.014 });
  resonance(g.ctx, g.out, at + 0.003, 210, 0.03, 0.03);
}

/** Back-compat alias used by the grid widgets: a plain key-down. */
export function playTick(preset: SoundPreset): void {
  playKeyDown(preset);
}
