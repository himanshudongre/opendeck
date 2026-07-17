import type { Session } from '@agentdeck/protocol';
import { useEffect, useState } from 'react';
import { Keycap } from '../components/Keycap.js';
import { StatusDot, statusColorVar } from '../components/StatusDot.js';
import { formatCost, formatElapsed, formatTokens, statusLabel } from '../lib/format.js';
import { controller } from '../lib/controller.js';
import { useDeck } from '../state/store.js';
import type { TileSize } from '../state/layouts.js';

const HARNESS_MARKS: Record<Session['harness'], string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  simulator: 'sim',
};

/** Live elapsed: statusSince drives a once-a-second re-render while active. */
function useElapsed(session: Session): string {
  const [, bump] = useState(0);
  const active = session.status === 'working' || session.status === 'thinking';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => bump((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const base = session.stats.elapsedMs;
  const extra = active ? Date.now() - session.lastActivity : 0;
  return formatElapsed(base + Math.max(0, extra));
}

export function AgentTile({ session, size }: { session: Session; size: TileSize }) {
  const focusSession = useDeck((state) => state.focusSession);
  const editMode = useDeck((state) => state.editMode);
  const moveSession = useDeck((state) => state.moveSession);
  const elapsed = useElapsed(session);
  const color = statusColorVar(session.status);
  const waiting = session.status === 'waiting_input' || session.status === 'waiting_permission';

  return (
    <div className="relative">
      <Keycap
        label={`${session.title} — ${statusLabel(session.status)}`}
        glow={color}
        className={`w-full text-left ${size === 'S' ? 'p-2.5' : 'p-3.5'}`}
        onPress={() => {
          if (!editMode) {
            focusSession(session.id);
            controller.subscribe(session.id);
          }
        }}
        onLongPress={() => {
          if (!editMode) useDeck.getState().setEditMode(true);
        }}
      >
        <div className="flex items-center gap-2">
          <StatusDot status={session.status} size={size === 'S' ? 8 : 10} />
          <span
            className={`font-data uppercase tracking-wider text-ink-3 ${size === 'S' ? 'text-[9px]' : 'text-[10px]'}`}
          >
            {HARNESS_MARKS[session.harness]}
            {session.mode === 'observed' ? ' · terminal' : ''}
          </span>
          <span className="font-data ml-auto text-[10px] text-ink-3">{elapsed}</span>
        </div>

        <h3
          className={`font-display mt-1.5 leading-snug text-ink-1 ${
            size === 'S' ? 'text-xs' : size === 'L' ? 'text-base' : 'text-sm'
          }`}
        >
          {session.title}
        </h3>

        {size !== 'S' && session.branch !== undefined && (
          <p className="font-data mt-0.5 truncate text-[10px] text-ink-3">
            {session.repo !== undefined ? `${session.repo} · ` : ''}
            {session.branch}
          </p>
        )}

        <p
          className={`mt-1.5 truncate text-[11px] ${waiting ? 'pulse-waiting' : ''}`}
          style={{ color: waiting ? color : 'var(--ink-2)' }}
        >
          {waiting ||
          session.status === 'done' ||
          session.status === 'error' ||
          session.status === 'idle'
            ? statusLabel(session.status)
            : session.currentTool
              ? `${session.currentTool.name} · ${session.currentTool.detail}`
              : statusLabel(session.status)}
        </p>

        <div className="font-data mt-2 flex items-center gap-2 text-[10px] text-ink-3">
          <span>{formatTokens(session.stats.inputTokens + session.stats.outputTokens)} tok</span>
          {session.stats.costUsd !== undefined && <span>{formatCost(session.stats.costUsd)}</span>}
          {session.model !== undefined && size === 'L' && (
            <span className="truncate">{session.model}</span>
          )}
          <span
            aria-hidden
            className="ml-auto h-1 w-10 overflow-hidden rounded-full"
            style={{ background: 'var(--hairline)' }}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${String(Math.min(100, ((session.stats.costUsd ?? session.stats.outputTokens / 100_000) / 0.5) * 100))}%`,
                background: color,
              }}
            />
          </span>
        </div>
      </Keycap>

      {editMode && (
        <div className="absolute right-1.5 top-1.5 z-20 flex gap-1">
          <button
            type="button"
            aria-label={`Move ${session.title} earlier`}
            className="keycap px-2 py-0.5 text-[10px] text-ink-2"
            onClick={() => moveSession(session.id, -1)}
          >
            ←
          </button>
          <button
            type="button"
            aria-label={`Move ${session.title} later`}
            className="keycap px-2 py-0.5 text-[10px] text-ink-2"
            onClick={() => moveSession(session.id, 1)}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
