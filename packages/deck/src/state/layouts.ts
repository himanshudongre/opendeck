import type { ActionKind } from '@agentdeck/protocol';

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
}

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
}

export const DEFAULT_ACTION_KEYS: ActionKeyBinding[] = [
  { id: 'approve', label: 'Approve', kind: 'approve', accent: 'done' },
  { id: 'deny', label: 'Deny', kind: 'deny', accent: 'error' },
  { id: 'interrupt', label: 'Interrupt', kind: 'interrupt', accent: 'waiting' },
  {
    id: 'run-tests',
    label: 'Run tests',
    kind: 'prompt_template',
    args: { text: 'Run the test suite and fix any failures you find.' },
    accent: 'working',
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
