import { Settings as SettingsIcon } from 'lucide-react';
import { formatCost, formatLatency, formatTokens } from '../lib/format.js';
import { useDeck } from '../state/store.js';

const CONNECTION_LABEL: Record<string, string> = {
  connected: 'connected',
  reconnecting: 'reconnecting…',
  offline: 'hub offline',
  unpaired: 'not paired',
};

const CONNECTION_COLOR: Record<string, string> = {
  connected: 'var(--st-done)',
  reconnecting: 'var(--st-waiting)',
  offline: 'var(--st-error)',
  unpaired: 'var(--st-idle)',
};

/** Fleet totals + live, honest hub latency (SPEC §6). */
export function StatBar() {
  const sessions = useDeck((state) => state.sessions);
  const connection = useDeck((state) => state.connection);
  const latency = useDeck((state) => state.latencyMs);
  const setScreen = useDeck((state) => state.setScreen);

  const list = Object.values(sessions);
  const running = list.filter((s) => s.status === 'working' || s.status === 'thinking').length;
  const waiting = list.filter(
    (s) => s.status === 'waiting_input' || s.status === 'waiting_permission',
  ).length;
  const tokens = list.reduce((sum, s) => sum + s.stats.inputTokens + s.stats.outputTokens, 0);
  const cost = list.reduce((sum, s) => sum + (s.stats.costUsd ?? 0), 0);

  return (
    <header className="hairline-b flex items-center gap-3 px-4 py-2.5">
      <span className="font-display text-sm tracking-wide" style={{ color: 'var(--brass)' }}>
        ▲ opendeck
      </span>
      <span className="font-data text-[11px] text-ink-2">
        {running} running · {waiting} waiting
      </span>
      <span className="font-data ml-auto hidden text-[11px] text-ink-3 sm:inline">
        {formatTokens(tokens)} tok · {formatCost(cost)}
      </span>
      <span className="font-data text-[11px] text-ink-3">
        {connection === 'connected' ? formatLatency(latency) : CONNECTION_LABEL[connection]}
      </span>
      <span
        aria-label={`Connection: ${CONNECTION_LABEL[connection] ?? connection}`}
        role="status"
        className={`inline-block h-2.5 w-2.5 rounded-full ${connection === 'reconnecting' ? 'pulse-waiting' : ''}`}
        style={{
          background: CONNECTION_COLOR[connection],
          boxShadow: `0 0 8px ${CONNECTION_COLOR[connection] ?? ''}`,
        }}
      />
      <button
        type="button"
        aria-label="Open settings"
        className="keycap p-1.5"
        onClick={() => setScreen('settings')}
      >
        <SettingsIcon aria-hidden size={13} style={{ color: 'var(--ink-3)' }} />
      </button>
    </header>
  );
}
