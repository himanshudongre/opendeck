import type { SessionStatus } from '@agentdeck/protocol';

export function statusColorVar(status: SessionStatus): string {
  switch (status) {
    case 'thinking':
      return 'var(--st-thinking)';
    case 'working':
      return 'var(--st-working)';
    case 'waiting_input':
    case 'waiting_permission':
      return 'var(--st-waiting)';
    case 'done':
      return 'var(--st-done)';
    case 'error':
      return 'var(--st-error)';
    case 'idle':
    case 'disconnected':
      return 'var(--st-idle)';
  }
}

export function statusPulseClass(status: SessionStatus): string {
  if (status === 'thinking') return 'pulse-thinking';
  if (status === 'waiting_input' || status === 'waiting_permission') return 'pulse-waiting';
  return '';
}

/**
 * An LED under frosted plastic, not a flat circle: a white-hot core inside
 * the status color with a tight halo and a wide soft bloom.
 */
export function StatusDot({ status, size = 10 }: { status: SessionStatus; size?: number }) {
  const color = statusColorVar(status);
  const lit = status !== 'idle' && status !== 'disconnected';
  return (
    <span
      aria-hidden
      className={`status-fade inline-block rounded-full ${statusPulseClass(status)}`}
      style={{
        width: size,
        height: size,
        background: lit
          ? `radial-gradient(circle at 38% 34%, rgb(255 255 255 / 0.9), ${color} 58%)`
          : color,
        boxShadow: lit
          ? `0 0 ${String(size * 0.6)}px ${color}, 0 0 ${String(size * 2.2)}px ${color}`
          : 'inset 0 1px 2px rgb(0 0 0 / 0.4)',
      }}
    />
  );
}
