import type { PermissionRequest, Session, SetEffortPayload } from '@opendeck/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createCoalescer } from '../lib/coalescer.js';
import { controller } from '../lib/controller.js';
import { formatCost, formatTokens, statusLabel } from '../lib/format.js';
import { startVoice, voiceAvailability, type VoiceSession } from '../lib/voice.js';
import { axesFor, type DialAxis } from '../widgets/Dial.js';
import { DEFAULT_JOG_BINDINGS, type ActionKeyBinding, type JogDirection } from './layouts.js';
import { useDeck, type ConnectionState } from './store.js';

/**
 * The micro device's brain, shared by both renderers (the CSS device and the
 * WebGL device). Everything stateful — which agent has attention, what the
 * LCD says, what each cap does — lives here so the two faces can never
 * disagree on behavior.
 */

export const KEYS_PER_PAGE = 6;
export const SWEEP_DEG = 270;
export const START_DEG = -135;

export interface MicroModel {
  attention: Session | undefined;
  pending: PermissionRequest | undefined;
  keySlots: (Session | undefined)[];
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  setSelectedId: (id: string | undefined) => void;
  commandKeys: ActionKeyBinding[];
  bindingArmed: (binding: ActionKeyBinding) => boolean;
  bindingLabel: (binding: ActionKeyBinding) => string;
  fireBinding: (binding: ActionKeyBinding) => void;
  openFocus: (id: string) => void;
  lcdLine: string;
  lcdStats: string;
  connection: ConnectionState;
}

export function useMicroModel(): MicroModel {
  const sessions = useDeck((state) => state.sessions);
  const order = useDeck((state) => state.order);
  const permissions = useDeck((state) => state.permissions);
  const connection = useDeck((state) => state.connection);
  const focusSession = useDeck((state) => state.focusSession);
  const layout = useDeck((state) => state.layout);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const list = order.flatMap((id) => (sessions[id] ? [sessions[id]] : []));
  const pageCount = Math.max(1, Math.ceil(list.length / KEYS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = list.slice(
    currentPage * KEYS_PER_PAGE,
    currentPage * KEYS_PER_PAGE + KEYS_PER_PAGE,
  );

  const attention =
    (selectedId !== undefined ? sessions[selectedId] : undefined) ??
    list.find((s) => s.status === 'waiting_permission') ??
    list.find((s) => s.status === 'waiting_input') ??
    list[0];

  const pending = attention
    ? Object.values(permissions).find((request) => request.sessionId === attention.id)
    : undefined;

  const openFocus = (id: string): void => {
    focusSession(id);
    controller.subscribe(id);
  };

  const commandKeys = layout.actionKeys.slice(0, 3);

  const bindingArmed = (binding: ActionKeyBinding): boolean => {
    if (binding.kind === 'approve' || binding.kind === 'deny') return pending !== undefined;
    if (binding.kind === 'shell' || binding.kind === 'new_session') return true;
    if (binding.kind === 'interrupt') return attention?.capabilities.includes('interrupt') === true;
    return attention !== undefined;
  };

  const bindingLabel = (binding: ActionKeyBinding): string =>
    (binding.kind === 'approve' || binding.kind === 'deny') && pending
      ? `${binding.label} ${pending.tool.name}`
      : binding.label;

  const fireBinding = (binding: ActionKeyBinding): void => {
    if ((binding.kind === 'approve' || binding.kind === 'deny') && pending) {
      controller.respondPermission(pending.id, binding.kind);
      return;
    }
    controller.action({
      kind: binding.kind,
      ...(attention === undefined ? {} : { sessionId: attention.id }),
      ...(binding.args === undefined ? {} : { args: binding.args }),
    });
  };

  const lcdLine = attention
    ? pending
      ? `${attention.title} · approve ${pending.tool.name}?`
      : `${attention.title} · ${statusLabel(attention.status)}`
    : 'no agents · run opendeck --demo';
  const lcdStats = attention
    ? `${formatTokens(attention.stats.inputTokens + attention.stats.outputTokens)} tok${
        attention.stats.costUsd !== undefined ? ` · ${formatCost(attention.stats.costUsd)}` : ''
      } · ${attention.harness}`
    : '';

  const keySlots = Array.from({ length: KEYS_PER_PAGE }, (_, index) => visible[index]);

  return {
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
  };
}

export interface KnobModel {
  axis: DialAxis | undefined;
  axes: DialAxis[];
  cycleAxis: () => void;
  valueIndex: number;
  steps: number;
  knobDeg: number;
  /** Steps to an absolute detent; `flush` sends the coalesced wire message. */
  setIndex: (next: number, flush: boolean, onDetent?: () => void) => void;
}

export function useKnobModel(target: Session | undefined): KnobModel {
  const axes = useMemo(() => (target ? axesFor(target) : []), [target]);
  const [axisIndex, setAxisIndex] = useState(0);
  const axis = axes[Math.min(axisIndex, Math.max(0, axes.length - 1))];
  const [valueIndex, setValueIndex] = useState(0);

  useEffect(() => {
    setAxisIndex(0);
  }, [target?.id]);
  useEffect(() => {
    if (axis) setValueIndex(Math.max(0, axis.values.indexOf(axis.initial)));
  }, [axis?.axis, target?.id]);

  const coalescer = useMemo(
    () =>
      createCoalescer<SetEffortPayload>((payload) => {
        controller.setEffort(payload);
      }),
    [],
  );

  const steps = axis?.values.length ?? 1;
  const knobDeg =
    START_DEG + (steps === 1 ? SWEEP_DEG / 2 : (valueIndex / (steps - 1)) * SWEEP_DEG);

  const setIndex = (next: number, flush: boolean, onDetent?: () => void): void => {
    if (!target || !axis) return;
    const clamped = Math.max(0, Math.min(steps - 1, next));
    if (clamped !== valueIndex) {
      setValueIndex(clamped);
      onDetent?.();
      const value = axis.values[clamped];
      if (value !== undefined) coalescer.push({ sessionId: target.id, axis: axis.axis, value });
    }
    if (flush) coalescer.flush();
  };

  return {
    axis,
    axes,
    cycleAxis: () => setAxisIndex((axisIndex + 1) % Math.max(1, axes.length)),
    valueIndex,
    steps,
    knobDeg,
    setIndex,
  };
}

/** Push-to-talk state shared by both mic bars. */
export function useVoiceBar(targetId: string | undefined): {
  available: boolean;
  listening: boolean;
  transcript: string;
  begin: () => void;
  stop: () => void;
} {
  const voiceLang = useDeck((state) => state.settings.voiceLang);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const session = useRef<VoiceSession | undefined>(undefined);
  const ready = voiceAvailability() === 'available';

  return {
    available: ready && targetId !== undefined,
    listening,
    transcript,
    begin: () => {
      if (!ready || targetId === undefined) return;
      setListening(true);
      setTranscript('');
      session.current = startVoice(
        voiceLang,
        (text) => setTranscript(text),
        (finalText) => {
          setListening(false);
          setTranscript('');
          if (finalText.length > 0) controller.voicePrompt(targetId, finalText, voiceLang);
        },
      );
    },
    stop: () => session.current?.stop(),
  };
}

/** Flick-to-workflow used by both the joystick and the jog pad. */
export function useJogFire(targetId: string | undefined): {
  jog: Record<JogDirection, { label: string; template: string }>;
  fire: (direction: JogDirection) => void;
} {
  const jog = useDeck((state) => state.layout.jog) ?? DEFAULT_JOG_BINDINGS;
  return {
    jog,
    fire: (direction) => {
      if (targetId === undefined) return;
      controller.action({
        sessionId: targetId,
        kind: 'prompt_template',
        args: { text: jog[direction].template },
      });
    },
  };
}
