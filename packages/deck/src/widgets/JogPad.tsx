import { useRef, useState } from 'react';
import { controller } from '../lib/controller.js';
import { hapticTick } from '../lib/haptics.js';
import { playTick } from '../lib/sound.js';
import { useDeck } from '../state/store.js';

type JogDirection = 'up' | 'down' | 'left' | 'right';

interface JogBinding {
  label: string;
  template: string;
}

/** Four-direction flick pad mapped to prompt-template workflows (SPEC §6). */
export const JOG_BINDINGS: Record<JogDirection, JogBinding> = {
  up: { label: 'Tests', template: 'Run the failing tests and fix them.' },
  right: {
    label: 'Diff',
    template: 'Review the current diff and list problems before anything else.',
  },
  down: {
    label: 'Commit',
    template: 'Commit the current work with a conventional commit message.',
  },
  left: { label: 'Status', template: 'Explain what you are doing right now and what remains.' },
};

const FLICK_THRESHOLD_PX = 24;

export function JogPad() {
  const focused = useDeck((state) => state.focusedSessionId);
  const sessions = useDeck((state) => state.sessions);
  const order = useDeck((state) => state.order);
  const settings = useDeck((state) => state.settings);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const [lastFired, setLastFired] = useState<JogDirection | undefined>(undefined);

  const target =
    (focused !== null && sessions[focused]?.capabilities.includes('prompt') === true
      ? focused
      : undefined) ?? order.find((id) => sessions[id]?.capabilities.includes('prompt') === true);

  const fire = (direction: JogDirection): void => {
    if (target === undefined) return;
    hapticTick(settings.haptics, 12);
    playTick(settings.sound);
    setLastFired(direction);
    window.setTimeout(() => setLastFired(undefined), 400);
    controller.action({
      sessionId: target,
      kind: 'prompt_template',
      args: { text: JOG_BINDINGS[direction].template },
    });
  };

  return (
    <div
      role="group"
      aria-label="Jog pad: flick to send a workflow prompt"
      className={`keycap relative h-24 w-24 touch-none ${target === undefined ? 'opacity-40' : ''}`}
      onPointerDown={(event) => {
        start.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        if (!start.current || target === undefined) return;
        const dx = event.clientX - start.current.x;
        const dy = event.clientY - start.current.y;
        start.current = undefined;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < FLICK_THRESHOLD_PX) return;
        if (Math.abs(dx) > Math.abs(dy)) fire(dx > 0 ? 'right' : 'left');
        else fire(dy > 0 ? 'down' : 'up');
      }}
    >
      {(
        [
          ['up', 'inset-x-0 top-1 text-center'],
          ['down', 'inset-x-0 bottom-1 text-center'],
          ['left', 'left-1.5 top-1/2 -translate-y-1/2'],
          ['right', 'right-1.5 top-1/2 -translate-y-1/2'],
        ] as [JogDirection, string][]
      ).map(([direction, position]) => (
        <span
          key={direction}
          className={`font-data absolute text-[8px] uppercase tracking-wide ${position}`}
          style={{ color: lastFired === direction ? 'var(--brass)' : 'var(--ink-3)' }}
        >
          {JOG_BINDINGS[direction].label}
        </span>
      ))}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'var(--hairline)' }}
      />
    </div>
  );
}
