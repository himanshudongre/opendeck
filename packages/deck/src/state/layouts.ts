import type { ActionKind } from '@opendeck/protocol';

export type LayoutPreset =
  'phone-portrait' | 'phone-landscape' | 'tablet' | 'desktop-strip' | 'micro';
export type TileSize = 'S' | 'M' | 'L';

export interface ActionKeyBinding {
  id: string;
  label: string;
  kind: ActionKind;
  args?: Record<string, string | number | boolean>;
  /** Optional per-key accent token name (a status color, never brass). */
  accent?: 'working' | 'waiting' | 'done' | 'error';
  /** Icon name from the curated set in state/icons.ts (micro command keys). */
  icon?: string;
}

export type JogDirection = 'up' | 'down' | 'left' | 'right';

export interface JogBinding {
  label: string;
  template: string;
}

/** Flick-to-workflow defaults; every direction is rebindable in layout JSON. */
export const DEFAULT_JOG_BINDINGS: Record<JogDirection, JogBinding> = {
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

export interface WidgetVisibility {
  statBar: boolean;
  ticker: boolean;
  actionKeys: boolean;
  dial: boolean;
  jogPad: boolean;
  voiceKey: boolean;
}

export interface LayoutConfig {
  preset: LayoutPreset;
  tileSize: TileSize;
  widgets: WidgetVisibility;
  actionKeys: ActionKeyBinding[];
  /** Absent in older saved layouts; readers fall back to the defaults. */
  jog?: Record<JogDirection, JogBinding>;
}

export const DEFAULT_ACTION_KEYS: ActionKeyBinding[] = [
  { id: 'interrupt', label: 'Interrupt', kind: 'interrupt', accent: 'waiting', icon: 'zap' },
  { id: 'approve', label: 'Approve', kind: 'approve', accent: 'done', icon: 'check' },
  { id: 'deny', label: 'Deny', kind: 'deny', accent: 'error', icon: 'x' },
  {
    id: 'run-tests',
    label: 'Run tests',
    kind: 'prompt_template',
    args: { text: 'Run the test suite and fix any failures you find.' },
    accent: 'working',
    icon: 'test-tube',
  },
];

const ALL_WIDGETS: WidgetVisibility = {
  statBar: true,
  ticker: true,
  actionKeys: true,
  dial: true,
  jogPad: true,
  voiceKey: true,
};

/** Four shipped presets (SPEC §6); free-form grid editing is v1.1. */
export const LAYOUT_PRESETS: Record<LayoutPreset, LayoutConfig> = {
  'phone-portrait': {
    preset: 'phone-portrait',
    tileSize: 'M',
    widgets: { ...ALL_WIDGETS, jogPad: false },
    actionKeys: DEFAULT_ACTION_KEYS,
  },
  'phone-landscape': {
    preset: 'phone-landscape',
    tileSize: 'S',
    widgets: { ...ALL_WIDGETS, jogPad: false, ticker: false },
    actionKeys: DEFAULT_ACTION_KEYS,
  },
  tablet: {
    preset: 'tablet',
    tileSize: 'M',
    widgets: { ...ALL_WIDGETS },
    actionKeys: DEFAULT_ACTION_KEYS,
  },
  'desktop-strip': {
    preset: 'desktop-strip',
    tileSize: 'S',
    widgets: { ...ALL_WIDGETS, dial: false, jogPad: false, voiceKey: false },
    actionKeys: DEFAULT_ACTION_KEYS.slice(0, 2),
  },
  // The whole deck rendered as one physical device (Codex Micro grammar).
  micro: {
    preset: 'micro',
    tileSize: 'M',
    widgets: { ...ALL_WIDGETS },
    actionKeys: DEFAULT_ACTION_KEYS,
  },
};

/** Grid column class per preset+size — the whole layout system in one place. */
export function gridColumns(preset: LayoutPreset, size: TileSize): number {
  const base: Record<LayoutPreset, number> = {
    'phone-portrait': 2,
    'phone-landscape': 3,
    tablet: 3,
    'desktop-strip': 6,
    micro: 2,
  };
  const adjust = size === 'S' ? 1 : size === 'L' ? -1 : 0;
  return Math.max(1, base[preset] + adjust);
}
