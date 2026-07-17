import { useDeck } from '../state/store.js';

const LEVEL_COLOR: Record<string, string> = {
  info: 'var(--ink-3)',
  warn: 'var(--st-waiting)',
  error: 'var(--st-error)',
};

/** One-line scrolling fleet feed (SPEC §6). */
export function Ticker() {
  const ticker = useDeck((state) => state.ticker);
  const latest = ticker.slice(-4).reverse();

  if (latest.length === 0) {
    return (
      <div className="hairline-b overflow-hidden px-4 py-1.5">
        <p className="font-data truncate text-[11px] text-ink-3">Fleet events appear here.</p>
      </div>
    );
  }

  return (
    <div className="hairline-b overflow-hidden px-4 py-1.5" role="log" aria-label="Fleet events">
      <div className="ticker-slide whitespace-nowrap will-change-transform">
        {latest.map((entry) => (
          <span
            key={entry.id}
            className="font-data mr-10 text-[11px]"
            style={{ color: LEVEL_COLOR[entry.level] }}
          >
            {entry.text}
          </span>
        ))}
      </div>
    </div>
  );
}
