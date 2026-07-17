import { useState } from 'react';
import { Keycap } from '../components/Keycap.js';
import { controller } from '../lib/controller.js';
import type { ActionKeyBinding } from '../state/layouts.js';
import { useDeck } from '../state/store.js';

const ACCENT_VARS: Record<NonNullable<ActionKeyBinding['accent']>, string> = {
  working: 'var(--st-working)',
  waiting: 'var(--st-waiting)',
  done: 'var(--st-done)',
  error: 'var(--st-error)',
};

/**
 * A bindable key (SPEC §6). Targets the focused session, else the session
 * that needs attention. `shell` bindings arm on first press and fire on the
 * confirm press (SPEC §8) — never a single-tap shell execution.
 */
export function ActionKey({ binding }: { binding: ActionKeyBinding }) {
  const focused = useDeck((state) => state.focusedSessionId);
  const sessions = useDeck((state) => state.sessions);
  const permissions = useDeck((state) => state.permissions);
  const [armed, setArmed] = useState(false);

  const target =
    focused ??
    Object.values(sessions).find(
      (session) =>
        session.status === 'waiting_permission' &&
        Object.values(permissions).some((request) => request.sessionId === session.id),
    )?.id ??
    Object.values(sessions).find((session) => session.status === 'waiting_input')?.id;

  const needsSession = binding.kind !== 'shell' && binding.kind !== 'new_session';
  const disabled = needsSession && target === undefined;
  const accent = binding.accent !== undefined ? ACCENT_VARS[binding.accent] : undefined;

  const fire = (): void => {
    if (binding.kind === 'shell') {
      if (!armed) {
        setArmed(true);
        window.setTimeout(() => setArmed(false), 3000);
        return;
      }
      setArmed(false);
      controller.action({ kind: 'shell', args: { ...binding.args, confirmed: true } });
      return;
    }
    controller.action({
      kind: binding.kind,
      ...(target === undefined ? {} : { sessionId: target }),
      ...(binding.args === undefined ? {} : { args: binding.args }),
    });
  };

  return (
    <Keycap
      label={armed ? `Confirm ${binding.label}` : binding.label}
      disabled={disabled}
      onPress={fire}
      className="min-h-12 flex-1 px-2 py-2"
      {...(accent !== undefined && !disabled ? { glow: accent } : {})}
    >
      <span className="flex h-full flex-col items-center justify-center gap-0.5">
        <span
          aria-hidden
          className="status-fade h-1 w-4 rounded-full"
          style={{
            background: accent ?? 'var(--hairline)',
            boxShadow: accent !== undefined && !disabled ? `0 0 7px ${accent}` : 'none',
          }}
        />
        <span className="font-display text-[11px] leading-tight text-ink-1">
          {armed ? 'Confirm?' : binding.label}
        </span>
      </span>
    </Keycap>
  );
}
