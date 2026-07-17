/**
 * High-frequency inputs (dial drag, jog) send one message per animation frame
 * carrying only the latest value (SPEC §3.4). The UI stays optimistic; the
 * network sees at most 60 msg/s per control.
 */
export interface Coalescer<T> {
  push: (value: T) => void;
  /** Send whatever is pending right now (pointer-up), skipping the frame wait. */
  flush: () => void;
  cancel: () => void;
}

type Scheduler = (callback: () => void) => number;
type Canceler = (handle: number) => void;

export function createCoalescer<T>(
  send: (value: T) => void,
  schedule: Scheduler = (cb) => requestAnimationFrame(cb),
  cancelScheduled: Canceler = (handle) => {
    cancelAnimationFrame(handle);
  },
): Coalescer<T> {
  let pending: { value: T } | undefined;
  let handle: number | undefined;

  const fire = (): void => {
    handle = undefined;
    if (!pending) return;
    const { value } = pending;
    pending = undefined;
    send(value);
  };

  return {
    push: (value) => {
      pending = { value };
      handle ??= schedule(fire);
    },
    flush: () => {
      if (handle !== undefined) {
        cancelScheduled(handle);
        handle = undefined;
      }
      fire();
    },
    cancel: () => {
      if (handle !== undefined) {
        cancelScheduled(handle);
        handle = undefined;
      }
      pending = undefined;
    },
  };
}
