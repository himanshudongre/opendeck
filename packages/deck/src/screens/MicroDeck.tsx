import type { Session } from '@opendeck/protocol';
import { MessageCirclePlus, Mic } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { StatusDot, statusColorVar } from '../components/StatusDot.js';
import { controller } from '../lib/controller.js';
import { statusLabel } from '../lib/format.js';
import { hapticTick } from '../lib/haptics.js';
import { playDetent, playKeyDown, playKeyUp } from '../lib/sound.js';
import { startVoice, voiceAvailability, type VoiceSession } from '../lib/voice.js';
import {
  START_DEG,
  SWEEP_DEG,
  useJogFire,
  useKnobModel,
  useMicroModel,
} from '../state/micro-model.js';
import { useDeck } from '../state/store.js';
import { keyIcon } from '../state/icons.js';

const ACCENT_TOKEN = {
  working: 'working',
  waiting: 'waiting',
  done: 'done',
  error: 'error',
} as const;

/** Bottom-out on press, a smaller brighter strike on release — like a switch. */
function usePress(): { down: () => void; up: () => void } {
  const settings = useDeck((state) => state.settings);
  return {
    down: () => {
      hapticTick(settings.haptics);
      playKeyDown(settings.sound);
    },
    up: () => {
      hapticTick(settings.haptics, 6);
      playKeyUp(settings.sound);
    },
  };
}

/** Porcelain build under light themes, graphite under dark ones. */
function useLightBuild(): boolean {
  const themeName = useDeck((state) => state.settings.themeName);
  const customTheme = useDeck((state) => state.settings.customTheme);
  return useMemo(() => {
    if (typeof getComputedStyle === 'undefined') return false;
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--surface-0')
      .trim()
      .replace('#', '');
    if (raw.length < 6) return false;
    const r = parseInt(raw.slice(0, 2), 16) / 255;
    const g = parseInt(raw.slice(2, 4), 16) / 255;
    const b = parseInt(raw.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
  }, [themeName, customTheme]);
}

/** One agent key: a frosted cap with the session's LED glowing beneath it. */
function AgentKey({
  session,
  selected,
  onSelect,
  onOpen,
}: {
  session: Session | undefined;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const press = usePress();
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const color = session ? statusColorVar(session.status) : undefined;
  const waiting = session?.status === 'waiting_permission' || session?.status === 'waiting_input';

  return (
    <div className="micro-socket aspect-square">
      {session && (
        <span
          aria-hidden
          className={`micro-glow ${waiting ? 'pulse-waiting' : ''}`}
          style={{ '--glow': color ?? 'transparent' } as React.CSSProperties}
        />
      )}
      <button
        type="button"
        disabled={session === undefined}
        aria-label={
          session ? `${session.title} — ${statusLabel(session.status)}` : 'Empty agent key'
        }
        className="micro-cap block disabled:cursor-default"
        style={
          selected ? { borderColor: 'var(--brass)', boxShadow: '0 0 0 1.5px var(--brass)' } : {}
        }
        onPointerDown={() => {
          if (!session) return;
          press.down();
          longPressed.current = false;
          timer.current = window.setTimeout(() => {
            longPressed.current = true;
            hapticTick(useDeck.getState().settings.haptics, 16);
            onOpen();
          }, 450);
        }}
        onPointerUp={() => {
          if (session) press.up();
          window.clearTimeout(timer.current);
        }}
        onPointerLeave={() => window.clearTimeout(timer.current)}
        onClick={() => {
          if (session && !longPressed.current) onSelect();
        }}
      >
        <span className="flex h-full w-full items-center justify-center">
          {session ? (
            <StatusDot status={session.status} size={11} />
          ) : (
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ background: 'rgb(127 127 140 / 0.25)' }}
            />
          )}
        </span>
      </button>
    </div>
  );
}

/** A circular outline command button — the reference sheet's icon buttons. */
function CommandKey({
  label,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const press = usePress();
  return (
    <div className="flex items-center justify-center">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        className="micro-round h-12 w-12 disabled:opacity-40"
        onPointerDown={() => {
          if (!disabled) press.down();
        }}
        onPointerUp={() => {
          if (!disabled) press.up();
        }}
        onClick={() => {
          if (!disabled) onPress();
        }}
      >
        {children}
      </button>
    </div>
  );
}

/** The reasoning knob: a clean dial with a cut notch; slide or arrow-key it. */
function MicroKnob({ target }: { target: Session | undefined }) {
  const settings = useDeck((state) => state.settings);
  const reduced = useReducedMotion() ?? false;
  const { axis, axes, cycleAxis, valueIndex, steps, knobDeg, setIndex } = useKnobModel(target);
  const knobRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const canDial = target !== undefined && axis !== undefined;
  const detent = (): void => {
    hapticTick(settings.haptics);
    playDetent(settings.sound);
  };

  const indexFromPointer = (event: { clientX: number; clientY: number }): number => {
    const rect = knobRef.current?.getBoundingClientRect();
    if (!rect) return valueIndex;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg > 180) deg -= 360;
    const clamped = Math.max(START_DEG, Math.min(START_DEG + SWEEP_DEG, deg));
    return Math.round(((clamped - START_DEG) / SWEEP_DEG) * (steps - 1));
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={knobRef}
        role="slider"
        aria-label={axis && target ? `${axis.label} dial for ${target.title}` : 'Dial (no agent)'}
        aria-valuemin={0}
        aria-valuemax={steps - 1}
        aria-valuenow={valueIndex}
        {...(axis?.values[valueIndex] === undefined
          ? {}
          : { 'aria-valuetext': axis.values[valueIndex] })}
        tabIndex={0}
        className={`micro-knob relative aspect-square w-full touch-none ${canDial ? '' : 'opacity-50'}`}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setIndex(indexFromPointer(event), false, detent);
        }}
        onPointerMove={(event) => {
          if (dragging.current) setIndex(indexFromPointer(event), false, detent);
        }}
        onPointerUp={() => {
          dragging.current = false;
          setIndex(valueIndex, true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
            setIndex(valueIndex + 1, true, detent);
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
            setIndex(valueIndex - 1, true, detent);
        }}
      >
        <motion.span
          aria-hidden
          className="absolute inset-0"
          animate={{ rotate: knobDeg }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 20 }}
        >
          <span aria-hidden className="micro-knob-notch" />
        </motion.span>
      </div>
      <button
        type="button"
        className="silkscreen"
        aria-label={
          axes.length > 1 && axis
            ? `Dial binds ${axis.label}; press to switch axis`
            : `Dial binds ${axis?.label ?? 'nothing'}`
        }
        disabled={axes.length <= 1}
        onClick={cycleAxis}
      >
        {axis ? `${axis.label} · ${axis.values[valueIndex] ?? ''}` : 'dial'}
      </button>
    </div>
  );
}

/** The joystick: a black knob in a dashed service outline; flick a workflow. */
function MicroStick({ targetId }: { targetId: string | undefined }) {
  const settings = useDeck((state) => state.settings);
  const { fire } = useJogFire(targetId);
  const reduced = useReducedMotion() ?? false;
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  const flick = (dx: number, dy: number): void => {
    if (targetId === undefined) return;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    const direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    hapticTick(settings.haptics, 12);
    playDetent(settings.sound);
    fire(direction);
  };

  return (
    <div
      role="group"
      aria-label="Joystick: flick to run a workflow"
      className={`micro-stick-zone aspect-square w-full touch-none ${targetId === undefined ? 'opacity-50' : ''}`}
      onPointerDown={(event) => {
        origin.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!origin.current) return;
        const dx = Math.max(-20, Math.min(20, event.clientX - origin.current.x));
        const dy = Math.max(-20, Math.min(20, event.clientY - origin.current.y));
        setTilt({ x: dx, y: dy });
      }}
      onPointerUp={(event) => {
        if (origin.current) {
          flick(event.clientX - origin.current.x, event.clientY - origin.current.y);
        }
        origin.current = undefined;
        setTilt({ x: 0, y: 0 });
      }}
    >
      <motion.span
        aria-hidden
        className="micro-stick-knob"
        animate={{ x: tilt.x * 0.4, y: tilt.y * 0.4 }}
        transition={
          reduced ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 24, mass: 0.6 }
        }
      />
    </div>
  );
}

/** Push-to-talk pill with a listening LED and live transcript. */
function MicBar({ targetId }: { targetId: string | undefined }) {
  const settings = useDeck((state) => state.settings);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const session = useRef<VoiceSession | undefined>(undefined);
  const available = voiceAvailability() === 'available' && targetId !== undefined;

  const begin = (): void => {
    if (!available) return;
    hapticTick(settings.haptics, 12);
    playKeyDown(settings.sound);
    setListening(true);
    setTranscript('');
    session.current = startVoice(
      settings.voiceLang,
      (text) => setTranscript(text),
      (finalText) => {
        setListening(false);
        setTranscript('');
        if (finalText.length > 0) {
          controller.voicePrompt(targetId, finalText, settings.voiceLang);
        }
      },
    );
  };

  return (
    <div className="relative flex-1">
      <button
        type="button"
        aria-label={
          available
            ? listening
              ? 'Listening — release to send'
              : 'Hold to talk'
            : 'Voice is unavailable on this connection. Enable voice in Settings.'
        }
        className={`micro-cap micro-pill flex h-12 w-full items-center justify-center gap-2 ${available ? '' : 'opacity-45'}`}
        onPointerDown={begin}
        onPointerUp={() => {
          if (available) playKeyUp(settings.sound);
          session.current?.stop();
        }}
        onPointerLeave={() => session.current?.stop()}
      >
        <Mic
          aria-hidden
          size={15}
          style={{ color: listening ? 'var(--st-waiting)' : 'var(--ink-2)' }}
        />
        <span
          aria-hidden
          className={`status-fade h-1 w-1 rounded-full ${listening ? 'pulse-waiting' : ''}`}
          style={{
            background: listening ? 'var(--st-waiting)' : 'rgb(127 127 140 / 0.35)',
            boxShadow: listening ? '0 0 6px var(--st-waiting)' : 'none',
          }}
        />
      </button>
      {listening && transcript.length > 0 && (
        <div className="panel absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 px-3 py-2">
          <p className="text-xs text-ink-1">{transcript}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The whole deck as one flat product render — the reference-sheet look,
 * viewed dead straight-on: frosted agent keys over LED glow, circular
 * outline commands, dashed joystick, mic pill — plus the advantages only a
 * screen has (a readout strip, unlimited agents via swipeable pages, full
 * diffs one long-press away).
 */
export function MicroDeck() {
  const setEditMode = useDeck((state) => state.setEditMode);
  const plateHold = useRef<number | undefined>(undefined);
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined);
  const light = useLightBuild();
  const {
    attention,
    pending,
    keySlots,
    page: currentPage,
    pageCount,
    setPage,
    setSelectedId,
    commandKeys,
    bindingArmed,
    bindingLabel,
    fireBinding,
    openFocus,
    lcdLine,
    lcdStats,
    connection,
  } = useMicroModel();

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-3">
      <div className={`micro-body w-full max-w-sm p-2.5 ${light ? 'micro-light' : ''}`}>
        <div
          className="micro-plate px-5 pb-4 pt-3"
          onContextMenu={(event) => {
            event.preventDefault();
            setEditMode(true);
          }}
          onPointerDown={(event) => {
            // Swipes anywhere on the plate page through agents; presses that
            // start on a control never become swipes.
            const onControl =
              event.target instanceof Element &&
              event.target.closest('button, [role="slider"], [role="group"]') !== null;
            swipe.current = onControl ? undefined : { x: event.clientX, y: event.clientY };
            // Long-press on the bare plate opens edit mode (touch devices
            // don't fire contextmenu). Presses on controls cancel it.
            if (event.target === event.currentTarget) {
              plateHold.current = window.setTimeout(() => setEditMode(true), 600);
            }
          }}
          onPointerUp={(event) => {
            window.clearTimeout(plateHold.current);
            const start = swipe.current;
            swipe.current = undefined;
            if (!start || pageCount <= 1) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) > 56 && Math.abs(dy) < Math.abs(dx) * 0.6) {
              const next = currentPage + (dx < 0 ? 1 : -1);
              setPage(Math.max(0, Math.min(pageCount - 1, next)));
            }
          }}
          onPointerLeave={() => window.clearTimeout(plateHold.current)}
        >
          <span
            aria-hidden
            className="micro-screw left-2 top-2"
            style={{ '--screw-angle': '38deg' } as React.CSSProperties}
          />
          <span
            aria-hidden
            className="micro-screw right-2 top-2"
            style={{ '--screw-angle': '105deg' } as React.CSSProperties}
          />
          <span
            aria-hidden
            className="micro-screw bottom-2 left-2"
            style={{ '--screw-angle': '150deg' } as React.CSSProperties}
          />
          <span
            aria-hidden
            className="micro-screw bottom-2 right-2"
            style={{ '--screw-angle': '75deg' } as React.CSSProperties}
          />

          <p
            aria-hidden
            className="silkscreen silkscreen-vert absolute right-1.5 top-1/2 -translate-y-1/2"
          >
            you can just ship things
          </p>

          {/* North marker, straight off the reference sheet. */}
          <p aria-hidden className="mb-1 text-center text-[13px] leading-none text-ink-3">
            ↑
          </p>

          {/* Readout strip: what the hardware wishes it had. */}
          <div className="micro-lcd mb-4 px-3 py-2">
            <p
              className="truncate text-[12px]"
              style={{ color: pending ? 'var(--st-waiting)' : '#d7dbe2' }}
            >
              {lcdLine}
            </p>
            <div className="flex items-center justify-between">
              <p className="text-[10px]" style={{ color: '#8a909c' }}>
                {lcdStats}
              </p>
              <span
                role="status"
                aria-label={`Connection: ${connection}`}
                className={`inline-block h-1.5 w-1.5 rounded-full ${connection === 'reconnecting' ? 'pulse-waiting' : ''}`}
                style={{
                  background:
                    connection === 'connected'
                      ? 'var(--st-done)'
                      : connection === 'reconnecting'
                        ? 'var(--st-waiting)'
                        : 'var(--st-error)',
                  boxShadow: '0 0 5px currentColor',
                }}
              />
            </div>
          </div>

          {/* Row A: knob · two agent keys · joystick */}
          <div className="grid grid-cols-4 items-center gap-3">
            <MicroKnob target={attention} />
            <AgentKey
              session={keySlots[0]}
              selected={keySlots[0]?.id === attention?.id}
              onSelect={() => setSelectedId(keySlots[0]?.id)}
              onOpen={() => keySlots[0] && openFocus(keySlots[0].id)}
            />
            <AgentKey
              session={keySlots[1]}
              selected={keySlots[1]?.id === attention?.id}
              onSelect={() => setSelectedId(keySlots[1]?.id)}
              onOpen={() => keySlots[1] && openFocus(keySlots[1].id)}
            />
            <MicroStick targetId={attention?.id} />
          </div>

          {/* Row B: four agent keys */}
          <div className="mt-3 grid grid-cols-4 gap-3">
            {keySlots.slice(2).map((session, index) => (
              <AgentKey
                key={session?.id ?? `empty-${String(index)}`}
                session={session}
                selected={session !== undefined && session.id === attention?.id}
                onSelect={() => setSelectedId(session?.id)}
                onOpen={() => session && openFocus(session.id)}
              />
            ))}
          </div>

          {pageCount > 1 && (
            <div className="mt-2 flex justify-center">
              {Array.from({ length: pageCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Agent page ${String(index + 1)}`}
                  className="flex h-8 w-8 items-center justify-center"
                  onClick={() => setPage(index)}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: index === currentPage ? 'var(--brass)' : 'var(--hairline)',
                    }}
                  />
                </button>
              ))}
            </div>
          )}

          {/* Row C: circular command buttons — driven by layout.actionKeys,
              so every button's icon and action is rebindable via layout JSON. */}
          <div className="mt-4 grid grid-cols-4 gap-3">
            {commandKeys.map((binding) => {
              const Icon = keyIcon(binding.icon);
              const accentVar =
                binding.accent !== undefined
                  ? `var(--st-${ACCENT_TOKEN[binding.accent]})`
                  : 'var(--ink-2)';
              const armed = bindingArmed(binding);
              return (
                <CommandKey
                  key={binding.id}
                  label={bindingLabel(binding)}
                  disabled={!armed}
                  onPress={() => fireBinding(binding)}
                >
                  {Icon ? (
                    <Icon aria-hidden size={17} style={{ color: accentVar }} />
                  ) : (
                    <span
                      aria-hidden
                      className="font-data text-[10px]"
                      style={{ color: accentVar }}
                    >
                      {binding.label.slice(0, 3)}
                    </span>
                  )}
                </CommandKey>
              );
            })}
            <CommandKey
              label="Open the selected agent"
              disabled={attention === undefined}
              onPress={() => attention && openFocus(attention.id)}
            >
              <span aria-hidden className="font-data text-[15px]" style={{ color: 'var(--ink-2)' }}>
                ↗
              </span>
            </CommandKey>
          </div>

          {/* Row D: deco LED cluster · mic pill · new chat */}
          <div className="mt-4 flex items-center gap-3">
            <span aria-hidden className="grid grid-cols-2 gap-1 text-ink-3">
              <span className="micro-deco-dot" />
              <span className="micro-deco-dot" />
              <span className="micro-deco-dot" />
              <span className="micro-deco-dot" />
            </span>
            <MicBar targetId={attention?.id} />
            <CommandKey
              label="Start a new Claude session"
              onPress={() =>
                controller.action({ kind: 'new_session', args: { harness: 'claude' } })
              }
            >
              <MessageCirclePlus aria-hidden size={16} style={{ color: 'var(--ink-2)' }} />
            </CommandKey>
          </div>

          <p aria-hidden className="silkscreen mt-3 text-center">
            let&rsquo;s ship
          </p>
        </div>
      </div>
    </div>
  );
}
