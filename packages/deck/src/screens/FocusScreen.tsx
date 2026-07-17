import { ArrowLeft, OctagonX, Send, Skull } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Keycap } from '../components/Keycap.js';
import { PermissionCard } from '../components/PermissionCard.js';
import { StatusDot } from '../components/StatusDot.js';
import { controller } from '../lib/controller.js';
import { formatCost, formatElapsed, formatTokens, statusLabel } from '../lib/format.js';
import { useDeck } from '../state/store.js';
import { Dial } from '../widgets/Dial.js';
import { VoiceKey } from '../widgets/VoiceKey.js';

export function FocusScreen() {
  const focusedId = useDeck((state) => state.focusedSessionId);
  const session = useDeck((state) => (focusedId === null ? undefined : state.sessions[focusedId]));
  const transcript = useDeck((state) =>
    focusedId === null ? undefined : state.transcripts[focusedId],
  );
  const permissions = useDeck((state) => state.permissions);
  const focusSession = useDeck((state) => state.focusSession);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript?.length]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="panel px-6 py-6 text-center">
          <p className="text-sm text-ink-2">That session is gone.</p>
          <Keycap
            label="Back to the grid"
            className="mt-4 px-4 py-2"
            onPress={() => focusSession(null)}
          >
            <span className="font-display text-xs text-ink-1">Back to the grid</span>
          </Keycap>
        </div>
      </div>
    );
  }

  const pending = Object.values(permissions).filter((request) => request.sessionId === session.id);
  const canPrompt = session.capabilities.includes('prompt');

  const sendDraft = (): void => {
    const text = draft.trim();
    if (text.length === 0) return;
    controller.prompt(session.id, text);
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          aria-label="Back to the grid"
          className="keycap p-2"
          onClick={() => {
            controller.subscribe(null);
            focusSession(null);
          }}
        >
          <ArrowLeft aria-hidden size={14} style={{ color: 'var(--ink-2)' }} />
        </button>
        <div className="min-w-0">
          <h2 className="font-display truncate text-sm text-ink-1">{session.title}</h2>
          <p className="font-data flex items-center gap-1.5 text-[10px] text-ink-3">
            <StatusDot status={session.status} size={7} />
            {statusLabel(session.status)} · {session.harness}
            {session.model !== undefined ? ` · ${session.model}` : ''}
          </p>
        </div>
        <div className="font-data ml-auto text-right text-[10px] text-ink-3">
          {session.repo !== undefined && <p className="truncate">{session.repo}</p>}
          {session.branch !== undefined && <p className="truncate">{session.branch}</p>}
        </div>
      </header>

      <main ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {(transcript ?? []).length === 0 && pending.length === 0 && (
          <p className="font-data pt-8 text-center text-[11px] text-ink-3">
            {session.capabilities.includes('transcript')
              ? 'Transcript streams here while this session runs.'
              : 'This terminal session reports status only. Watch approvals and status here.'}
          </p>
        )}

        {(transcript ?? []).map((entry, index) => (
          <div
            key={`${String(entry.at)}-${String(index)}`}
            className={entry.role === 'user' ? 'panel ml-8 px-3 py-2' : 'px-1'}
          >
            <p className="font-data text-[9px] uppercase tracking-wide text-ink-3">{entry.role}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-1">
              {entry.text}
            </p>
          </div>
        ))}

        {session.currentTool && (session.status === 'working' || session.status === 'thinking') && (
          <p
            className="font-data flex items-center gap-2 px-1 text-[11px]"
            style={{ color: 'var(--st-working)' }}
          >
            <span aria-hidden className="pulse-thinking">
              ▸
            </span>
            {session.currentTool.name} · {session.currentTool.detail}
          </p>
        )}

        {pending.map((request) => (
          <PermissionCard key={request.id} request={request} />
        ))}
      </main>

      <footer
        className="hairline-b border-t px-3 py-2.5"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="font-data text-[10px] text-ink-3">
            {formatTokens(session.stats.inputTokens + session.stats.outputTokens)} tok
            {session.stats.costUsd !== undefined
              ? ` · ${formatCost(session.stats.costUsd)}`
              : ''} · {formatElapsed(session.stats.elapsedMs)} · {session.stats.turns} turns
          </div>
          <div className="flex items-center gap-2">
            {session.capabilities.includes('interrupt') && (
              <Keycap
                label="Interrupt this session"
                className="px-2.5 py-1.5"
                onPress={() => controller.action({ sessionId: session.id, kind: 'interrupt' })}
              >
                <span
                  className="flex items-center gap-1 text-[11px]"
                  style={{ color: 'var(--st-waiting)' }}
                >
                  <OctagonX aria-hidden size={12} /> Interrupt
                </span>
              </Keycap>
            )}
            {session.capabilities.includes('kill') && (
              <Keycap
                label="Kill this session"
                className="px-2.5 py-1.5"
                onPress={() => controller.action({ sessionId: session.id, kind: 'kill' })}
              >
                <span
                  className="flex items-center gap-1 text-[11px]"
                  style={{ color: 'var(--st-error)' }}
                >
                  <Skull aria-hidden size={12} /> Kill
                </span>
              </Keycap>
            )}
          </div>
        </div>

        <div className="flex items-end gap-2">
          {session.capabilities.includes('set_effort') && (
            <div className="scale-75 origin-bottom-left">
              <Dial />
            </div>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              type="text"
              value={draft}
              disabled={!canPrompt}
              placeholder={canPrompt ? 'Send a prompt' : 'This session takes no prompts'}
              aria-label={`Prompt ${session.title}`}
              className="keycap min-w-0 flex-1 px-3 py-2.5 text-[13px] text-ink-1 placeholder:text-ink-3"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') sendDraft();
              }}
            />
            <Keycap
              label="Send prompt"
              disabled={!canPrompt || draft.trim().length === 0}
              className="p-2.5"
              onPress={sendDraft}
            >
              <Send aria-hidden size={14} style={{ color: 'var(--brass)' }} />
            </Keycap>
            <VoiceKey />
          </div>
        </div>
      </footer>
    </div>
  );
}
