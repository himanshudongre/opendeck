import type { PermissionRequest, ServerMsg, Session } from '@opendeck/protocol';
import { create } from 'zustand';
import type { SoundPreset } from '../lib/sound.js';
import { LAYOUT_PRESETS, type LayoutConfig, type LayoutPreset, type TileSize } from './layouts.js';
import { GRAPHITE, PRESET_THEMES, applyTheme, type ThemeTokens } from './themes.js';

export type ConnectionState = 'connected' | 'reconnecting' | 'offline' | 'unpaired';
export type Screen = 'grid' | 'focus' | 'settings' | 'themes';

export interface TickerEntry {
  id: number;
  sessionId: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  at: number;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system';
  text: string;
  done: boolean;
  at: number;
}

export interface DeckSettings {
  themeName: string;
  /** Set when the theme editor diverges from a preset. */
  customTheme?: ThemeTokens;
  sound: SoundPreset;
  haptics: boolean;
  leftHand: boolean;
  voiceLang: string;
}

const TICKER_CAP = 50;
const TRANSCRIPT_CAP = 200;
const SETTINGS_KEY = 'opendeck.settings';
const LAYOUT_KEY = 'opendeck.layout';

let tickerSeq = 0;

export interface DeckState {
  connection: ConnectionState;
  latencyMs: number | undefined;
  hubVersion: string | undefined;
  /** How the last hello caught us up — `resumed` means zero missed events. */
  lastResume: 'fresh' | 'resumed' | 'snapshot' | undefined;
  lastSeq: number;
  sessions: Record<string, Session>;
  order: string[];
  permissions: Record<string, PermissionRequest>;
  ticker: TickerEntry[];
  transcripts: Record<string, TranscriptEntry[]>;
  screen: Screen;
  focusedSessionId: string | null;
  editMode: boolean;
  settings: DeckSettings;
  layout: LayoutConfig;

  applyServerMsg: (msg: ServerMsg) => void;
  setConnection: (state: ConnectionState) => void;
  setLatency: (ms: number) => void;
  focusSession: (sessionId: string | null) => void;
  setScreen: (screen: Screen) => void;
  setEditMode: (on: boolean) => void;
  updateSettings: (patch: Partial<DeckSettings>) => void;
  setTheme: (tokens: ThemeTokens, presetName?: string) => void;
  setLayoutPreset: (preset: LayoutPreset) => void;
  updateLayout: (patch: Partial<LayoutConfig>) => void;
  setTileSize: (size: TileSize) => void;
  moveSession: (sessionId: string, direction: -1 | 1) => void;
  pushTickerNote: (level: TickerEntry['level'], text: string) => void;
  reset: () => void;
}

function loadJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Removes one key from a record without mutation (and without `delete`). */
function omit<V>(record: Record<string, V>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([existing]) => existing !== key));
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: settings simply don't persist this session.
  }
}

const DEFAULT_SETTINGS: DeckSettings = {
  themeName: 'graphite',
  sound: 'clicky',
  haptics: true,
  leftHand: false,
  voiceLang: 'en-US',
};

export function activeTheme(settings: DeckSettings): ThemeTokens {
  if (settings.customTheme) return settings.customTheme;
  return PRESET_THEMES[settings.themeName] ?? GRAPHITE;
}

export const useDeck = create<DeckState>((set, get) => ({
  connection: 'unpaired',
  latencyMs: undefined,
  hubVersion: undefined,
  lastResume: undefined,
  lastSeq: 0,
  sessions: {},
  order: [],
  permissions: {},
  ticker: [],
  transcripts: {},
  screen: 'grid',
  focusedSessionId: null,
  editMode: false,
  settings: {
    ...DEFAULT_SETTINGS,
    ...(loadJson(SETTINGS_KEY) as Partial<DeckSettings> | undefined),
  },
  layout: (loadJson(LAYOUT_KEY) as LayoutConfig | undefined) ?? LAYOUT_PRESETS.micro,

  applyServerMsg: (msg) => {
    set((state) => {
      const next = fold(state, msg);
      return next === state ? state : next;
    });
  },

  setConnection: (connection) => set({ connection }),
  setLatency: (latencyMs) => set({ latencyMs }),

  focusSession: (sessionId) =>
    set((state) => ({
      focusedSessionId: sessionId,
      screen: sessionId === null ? 'grid' : 'focus',
      transcripts:
        sessionId === null || state.transcripts[sessionId]
          ? state.transcripts
          : { ...state.transcripts, [sessionId]: [] },
    })),

  setScreen: (screen) => set({ screen }),
  setEditMode: (editMode) => set({ editMode }),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    saveJson(SETTINGS_KEY, settings);
    set({ settings });
    applyTheme(activeTheme(settings));
  },

  setTheme: (tokens, presetName) => {
    const settings: DeckSettings = presetName
      ? (() => {
          const next = { ...get().settings, themeName: presetName };
          delete next.customTheme;
          return next;
        })()
      : { ...get().settings, themeName: 'custom', customTheme: tokens };
    saveJson(SETTINGS_KEY, settings);
    set({ settings });
    applyTheme(tokens);
  },

  setLayoutPreset: (preset) => {
    const layout = LAYOUT_PRESETS[preset];
    saveJson(LAYOUT_KEY, layout);
    set({ layout });
  },

  updateLayout: (patch) => {
    const layout = { ...get().layout, ...patch };
    saveJson(LAYOUT_KEY, layout);
    set({ layout });
  },

  setTileSize: (tileSize) => {
    const layout = { ...get().layout, tileSize };
    saveJson(LAYOUT_KEY, layout);
    set({ layout });
  },

  moveSession: (sessionId, direction) =>
    set((state) => {
      const index = state.order.indexOf(sessionId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= state.order.length) return state;
      const order = [...state.order];
      const swapped = order[target];
      if (swapped === undefined) return state;
      order[target] = sessionId;
      order[index] = swapped;
      return { order };
    }),

  pushTickerNote: (level, text) =>
    set((state) => ({
      ticker: pushTicker(state.ticker, { sessionId: '', level, text }),
    })),

  reset: () =>
    set({
      sessions: {},
      order: [],
      permissions: {},
      ticker: [],
      transcripts: {},
      focusedSessionId: null,
      screen: 'grid',
      lastSeq: 0,
    }),
}));

function pushTicker(ticker: TickerEntry[], entry: Omit<TickerEntry, 'id' | 'at'>): TickerEntry[] {
  tickerSeq += 1;
  const next = [...ticker, { ...entry, id: tickerSeq, at: Date.now() }];
  return next.length > TICKER_CAP ? next.slice(next.length - TICKER_CAP) : next;
}

/** The single reducer both live and replayed messages go through. */
function fold(state: DeckState, msg: ServerMsg): DeckState {
  switch (msg.type) {
    case 'hello': {
      const sessions: Record<string, Session> = {};
      for (const session of msg.payload.sessions) sessions[session.id] = session;
      const known = state.order.filter((id) => sessions[id] !== undefined);
      const fresh = msg.payload.sessions
        .map((session) => session.id)
        .filter((id) => !known.includes(id));
      return {
        ...state,
        hubVersion: msg.payload.hubVersion,
        lastResume: msg.payload.resume,
        sessions,
        order: [...known, ...fresh],
        lastSeq: msg.payload.seq,
        // A snapshot means we may have missed resolutions: drop stale cards.
        permissions: msg.payload.resume === 'resumed' ? state.permissions : {},
      };
    }
    case 'session_upsert': {
      const session = msg.payload;
      return {
        ...state,
        lastSeq: msg.seq,
        sessions: { ...state.sessions, [session.id]: session },
        order: state.order.includes(session.id) ? state.order : [...state.order, session.id],
      };
    }
    case 'session_removed': {
      const sessions = omit(state.sessions, msg.payload.sessionId);
      const permissions = Object.fromEntries(
        Object.entries(state.permissions).filter(
          ([, request]) => request.sessionId !== msg.payload.sessionId,
        ),
      );
      const transcripts = omit(state.transcripts, msg.payload.sessionId);
      return {
        ...state,
        lastSeq: msg.seq,
        sessions,
        permissions,
        transcripts,
        order: state.order.filter((id) => id !== msg.payload.sessionId),
        focusedSessionId:
          state.focusedSessionId === msg.payload.sessionId ? null : state.focusedSessionId,
        screen:
          state.focusedSessionId === msg.payload.sessionId && state.screen === 'focus'
            ? 'grid'
            : state.screen,
      };
    }
    case 'event':
      return foldEvent(state, msg);
    case 'permission_request':
      return {
        ...state,
        lastSeq: msg.seq,
        permissions: { ...state.permissions, [msg.payload.id]: msg.payload },
        ticker: pushTicker(state.ticker, {
          sessionId: msg.payload.sessionId,
          level: 'warn',
          text: `${sessionTitle(state, msg.payload.sessionId)} needs approval: ${msg.payload.tool.name}`,
        }),
      };
    case 'permission_resolved':
      return {
        ...state,
        lastSeq: msg.seq,
        permissions: omit(state.permissions, msg.payload.requestId),
      };
    case 'ack':
    case 'pong':
      return state;
    case 'error':
      return {
        ...state,
        ticker: pushTicker(state.ticker, {
          sessionId: '',
          level: 'error',
          text: msg.payload.message,
        }),
      };
  }
}

function foldEvent(state: DeckState, msg: Extract<ServerMsg, { type: 'event' }>): DeckState {
  const event = msg.payload;
  const base = { ...state, lastSeq: msg.seq };
  const session = state.sessions[event.sessionId];

  switch (event.kind) {
    case 'status': {
      if (!session) return base;
      const updated: Session = {
        ...session,
        status: event.status,
        statusSince: event.statusSince,
        ...(event.currentTool ? { currentTool: event.currentTool } : {}),
      };
      return { ...base, sessions: { ...state.sessions, [event.sessionId]: updated } };
    }
    case 'tool': {
      if (!session) return base;
      if (event.phase === 'start') {
        const updated: Session = { ...session, currentTool: event.tool };
        return { ...base, sessions: { ...state.sessions, [event.sessionId]: updated } };
      }
      return base;
    }
    case 'stats': {
      if (!session) return base;
      const updated: Session = { ...session, stats: event.stats };
      return { ...base, sessions: { ...state.sessions, [event.sessionId]: updated } };
    }
    case 'transcript': {
      const existing = state.transcripts[event.sessionId];
      if (existing === undefined) return base;
      const next = [
        ...existing,
        { role: event.role, text: event.text, done: event.done, at: msg.ts },
      ];
      return {
        ...base,
        transcripts: {
          ...state.transcripts,
          [event.sessionId]:
            next.length > TRANSCRIPT_CAP ? next.slice(next.length - TRANSCRIPT_CAP) : next,
        },
      };
    }
    case 'notice':
      return {
        ...base,
        ticker: pushTicker(state.ticker, {
          sessionId: event.sessionId,
          level: event.level,
          text: `${sessionTitle(state, event.sessionId)}: ${event.text}`,
        }),
      };
  }
}

function sessionTitle(state: DeckState, sessionId: string): string {
  return state.sessions[sessionId]?.title ?? sessionId;
}

/** Aggregate fleet state for the ambient Deskglow edges. */
export function aggregateStatus(
  sessions: Session[],
): 'error' | 'waiting' | 'working' | 'thinking' | 'idle' {
  let saw: 'error' | 'waiting' | 'working' | 'thinking' | 'idle' = 'idle';
  const rank = { idle: 0, thinking: 1, working: 2, waiting: 3, error: 4 } as const;
  for (const session of sessions) {
    const mapped =
      session.status === 'error'
        ? 'error'
        : session.status === 'waiting_input' || session.status === 'waiting_permission'
          ? 'waiting'
          : session.status === 'working'
            ? 'working'
            : session.status === 'thinking'
              ? 'thinking'
              : 'idle';
    if (rank[mapped] > rank[saw]) saw = mapped;
  }
  return saw;
}
