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

export function StatusDot({ status, size = 10 }: { status: SessionStatus; size?: number }) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full ${statusPulseClass(status)}`}
      style={{
        width: size,
        height: size,
        background: statusColorVar(status),
        boxShadow: `0 0 ${String(size)}px ${statusColorVar(status)}`,
      }}
    />
  );
}
