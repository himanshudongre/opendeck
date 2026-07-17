import type { Session, SetEffortPayload } from '@opendeck/protocol';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { controller } from '../lib/controller.js';
import { createCoalescer } from '../lib/coalescer.js';
import { hapticTick } from '../lib/haptics.js';
import { playDetent } from '../lib/sound.js';
import { useDeck } from '../state/store.js';

export interface DialAxis {
  axis: SetEffortPayload['axis'];
  label: string;
  values: string[];
  initial: string;
}

/** Per-harness dial bindings (SPEC §6): configuration, not harness logic. */
export function axesFor(session: Session): DialAxis[] {
  if (session.harness === 'codex') {
    return [
      {
        axis: 'effort',
        label: 'effort',
        values: ['minimal', 'low', 'medium', 'high', 'xhigh'],
        initial: 'medium',
      },
    ];
  }
  if (session.harness === 'claude') {
    return [
      {
        axis: 'model',
        label: 'model',
        values: ['haiku', 'sonnet', 'opus'],
        initial:
          session.model?.includes('opus') === true
            ? 'opus'
            : session.model?.includes('haiku') === true
              ? 'haiku'
              : 'sonnet',
      },
      { axis: 'thinking', label: 'thinking', values: ['off', '4k', '16k', '32k'], initial: 'off' },
    ];
  }
  return [
    { axis: 'effort', label: 'effort', values: ['low', 'medium', 'high'], initial: 'medium' },
  ];
}

const SWEEP_DEG = 270;
const START_DEG = -135;

/**
 * Circular drag with detent snap, brass needle, mono value readout
 * (SPEC §6/§7.3). Optimistic locally; the wire sees one coalesced
 * set_effort per animation frame (SPEC §3.4).
 */
export function Dial() {
  const sessions = useDeck((state) => state.sessions);
  const order = useDeck((state) => state.order);
  const focused = useDeck((state) => state.focusedSessionId);
  const settings = useDeck((state) => state.settings);

  const target = useMemo(() => {
    if (focused !== null && sessions[focused]?.capabilities.includes('set_effort') === true) {
      return sessions[focused];
    }
    for (const id of order) {
      const session = sessions[id];
      if (session?.capabilities.includes('set_effort') === true) return session;
    }
    return undefined;
  }, [sessions, order, focused]);

  const axes = useMemo(() => (target ? axesFor(target) : []), [target]);
  const [axisIndex, setAxisIndex] = useState(0);
  const axis = axes[Math.min(axisIndex, Math.max(0, axes.length - 1))];
  const [valueIndex, setValueIndex] = useState(0);

  useEffect(() => {
    setAxisIndex(0);
  }, [target?.id]);
  useEffect(() => {
    if (axis) setValueIndex(Math.max(0, axis.values.indexOf(axis.initial)));
    // Re-seat the needle whenever the bound axis changes.
  }, [axis?.axis, target?.id]);

  const coalescer = useMemo(
    () =>
      createCoalescer<SetEffortPayload>((payload) => {
        controller.setEffort(payload);
      }),
    [],
  );

  const dialRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const reduced = useReducedMotion() ?? false;

  if (!target || !axis) {
    return (
      <div className="keycap flex h-24 w-24 items-center justify-center rounded-full">
        <span className="font-data px-2 text-center text-[9px] text-ink-3">no dial target</span>
      </div>
    );
  }

  const setIndex = (next: number, flush: boolean): void => {
    const clamped = Math.max(0, Math.min(axis.values.length - 1, next));
    if (clamped !== valueIndex) {
      setValueIndex(clamped);
      hapticTick(settings.haptics);
      playDetent(settings.sound);
      const value = axis.values[clamped];
      if (value !== undefined) {
        coalescer.push({ sessionId: target.id, axis: axis.axis, value });
      }
    }
    if (flush) coalescer.flush();
  };

  const indexFromPointer = (event: { clientX: number; clientY: number }): number => {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return valueIndex;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg > 180) deg -= 360;
    const clamped = Math.max(START_DEG, Math.min(START_DEG + SWEEP_DEG, deg));
    const fraction = (clamped - START_DEG) / SWEEP_DEG;
    return Math.round(fraction * (axis.values.length - 1));
  };

  const needleDeg =
    START_DEG +
    (axis.values.length === 1
      ? SWEEP_DEG / 2
      : (valueIndex / (axis.values.length - 1)) * SWEEP_DEG);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={dialRef}
        role="slider"
        aria-label={`${axis.label} dial for ${target.title}`}
        aria-valuemin={0}
        aria-valuemax={axis.values.length - 1}
        aria-valuenow={valueIndex}
        aria-valuetext={axis.values[valueIndex]}
        tabIndex={0}
        className="keycap relative h-24 w-24 touch-none rounded-full"
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setIndex(indexFromPointer(event), false);
        }}
        onPointerMove={(event) => {
          if (dragging.current) setIndex(indexFromPointer(event), false);
        }}
        onPointerUp={() => {
          dragging.current = false;
          coalescer.flush();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') setIndex(valueIndex + 1, true);
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
            setIndex(valueIndex - 1, true);
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'repeating-conic-gradient(from 0deg, transparent 0deg 8deg, rgb(255 255 255 / 0.035) 8deg 10deg)',
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-2.5 rounded-full"
          style={{
            boxShadow: 'inset 0 2px 5px rgb(0 0 0 / 0.45), inset 0 -1px 0 rgb(255 255 255 / 0.05)',
          }}
        />
        {axis.values.map((value, index) => {
          const deg =
            START_DEG +
            (axis.values.length === 1
              ? SWEEP_DEG / 2
              : (index / (axis.values.length - 1)) * SWEEP_DEG);
          const active = index === valueIndex;
          return (
            <span
              key={value}
              aria-hidden
              className="status-fade absolute left-1/2 top-1/2 h-1 w-1 rounded-full"
              style={{
                background: active ? 'var(--brass)' : 'var(--hairline)',
                boxShadow: active ? '0 0 6px var(--brass)' : 'none',
                transform: `rotate(${String(deg)}deg) translateY(-42px)`,
                transformOrigin: '0 0',
              }}
            />
          );
        })}
        <motion.span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-8 w-0.5 rounded-full"
          style={{
            background: 'linear-gradient(180deg, var(--brass), rgb(0 0 0 / 0) 130%)',
            boxShadow: '0 0 5px rgb(216 179 106 / 0.55)',
            x: '-50%',
            y: '-100%',
            transformOrigin: '50% 100%',
          }}
          animate={{ rotate: needleDeg }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 22 }}
        />
        <span className="font-data absolute inset-x-0 bottom-4 text-center text-[10px] text-ink-1">
          {axis.values[valueIndex]}
        </span>
      </div>

      {axes.length > 1 ? (
        <button
          type="button"
          className="font-data text-[9px] uppercase tracking-wider text-ink-3"
          aria-label={`Dial binds ${axis.label}; press to switch axis`}
          onClick={() => setAxisIndex((axisIndex + 1) % axes.length)}
        >
          {axis.label} ⇄
        </button>
      ) : (
        <span className="font-data text-[9px] uppercase tracking-wider text-ink-3">
          {axis.label}
        </span>
      )}
    </div>
  );
}
