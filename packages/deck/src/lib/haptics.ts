/** One place decides whether the device buzzes; widgets just ask for a tick. */
export function hapticTick(enabled: boolean, durationMs = 8): void {
  if (!enabled) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(durationMs);
}
