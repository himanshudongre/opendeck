import { aggregateStatus, useDeck } from '../state/store.js';

const GLOW_VARS: Record<ReturnType<typeof aggregateStatus>, string> = {
  error: 'var(--st-error)',
  waiting: 'var(--st-waiting)',
  working: 'var(--st-working)',
  thinking: 'var(--st-thinking)',
  idle: 'var(--st-idle)',
};

/**
 * The ambient half of the Deskglow signature: viewport edges tinted toward
 * the aggregate fleet state, ≤8% opacity, removed entirely under
 * reduced-motion/-transparency (handled in CSS).
 */
export function DeskglowEdges() {
  const sessions = useDeck((state) => state.sessions);
  const aggregate = aggregateStatus(Object.values(sessions));
  return (
    <div
      aria-hidden
      className="deskglow-edges"
      data-aggregate={aggregate}
      style={{ '--glow-color': GLOW_VARS[aggregate] } as React.CSSProperties}
    />
  );
}
