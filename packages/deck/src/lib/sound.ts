/**
 * WebAudio-synthesized key ticks — the same clicky/silent choice the hardware
 * sells, as a free toggle (SPEC §7.3). No audio assets; everything is
 * generated at press time.
 */
export type SoundPreset = 'clicky' | 'silent' | 'off';

let context: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
  if (typeof AudioContext === 'undefined') return undefined;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

/** A short square blip through a lowpass plus a fingernail of noise. */
export function playTick(preset: SoundPreset): void {
  if (preset !== 'clicky') return;
  const ctx = audioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(700, now + 0.03);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3200, now);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.06);
}
