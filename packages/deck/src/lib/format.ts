/** `12:41`, `1:02:09` — tabular-mono friendly elapsed time. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/** `840`, `41.2k`, `1.3M` tokens. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** `$0.31`, `$12.40`; sub-cent costs stay honest instead of rounding to zero. */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return '— ms';
  return `${Math.max(0, Math.round(ms))} ms`;
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  waiting_input: 'needs input',
  waiting_permission: 'needs approval',
  done: 'done',
  error: 'error',
  disconnected: 'disconnected',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
