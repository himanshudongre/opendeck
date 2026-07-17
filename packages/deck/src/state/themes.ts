/**
 * Themes are token JSON (SPEC §7): the editor edits these fields live, and
 * export/import round-trips this exact shape.
 */
export interface ThemeTokens {
  name: string;
  surface0: string;
  surface1: string;
  keyFace: string;
  hairline: string;
  ink1: string;
  ink2: string;
  ink3: string;
  brass: string;
  stThinking: string;
  stWorking: string;
  stWaiting: string;
  stDone: string;
  stError: string;
  stIdle: string;
  /** 0–1 slab noise opacity; Workshop's paper wants a touch more. */
  noise: number;
}

export const GRAPHITE: ThemeTokens = {
  name: 'graphite',
  surface0: '#0E0F12',
  surface1: '#16181D',
  keyFace: '#1E2127',
  hairline: '#2A2E36',
  ink1: '#E9EBEE',
  ink2: '#9BA1AC',
  ink3: '#858B97',
  brass: '#D8B36A',
  stThinking: '#A78BFA',
  stWorking: '#4CC2FF',
  stWaiting: '#FFB454',
  stDone: '#3ECF8E',
  stError: '#FF5D5D',
  stIdle: '#3A3F48',
  noise: 0.02,
};

/** The Work Louder retro homage: cream slab, charcoal keys. */
export const WORKSHOP: ThemeTokens = {
  name: 'workshop',
  surface0: '#EDE6D6',
  surface1: '#E2D9C4',
  keyFace: '#2E2B27',
  hairline: '#CFC5AE',
  ink1: '#F4EFE4',
  ink2: '#B9B2A2',
  ink3: '#7B7466',
  brass: '#A97E2F',
  stThinking: '#8B6FE8',
  stWorking: '#1F9FE0',
  stWaiting: '#E8951C',
  stDone: '#2FA874',
  stError: '#D6493F',
  stIdle: '#57544C',
  noise: 0.035,
};

/** True-black AMOLED. */
export const VOID: ThemeTokens = {
  name: 'void',
  surface0: '#000000',
  surface1: '#0A0B0D',
  keyFace: '#101216',
  hairline: '#1C1F25',
  ink1: '#E9EBEE',
  ink2: '#8A909B',
  ink3: '#848A96',
  brass: '#D8B36A',
  stThinking: '#A78BFA',
  stWorking: '#4CC2FF',
  stWaiting: '#FFB454',
  stDone: '#3ECF8E',
  stError: '#FF5D5D',
  stIdle: '#2E323A',
  noise: 0,
};

export const PRESET_THEMES: Record<string, ThemeTokens> = {
  graphite: GRAPHITE,
  workshop: WORKSHOP,
  void: VOID,
};

const VARIABLE_MAP: [keyof ThemeTokens, string][] = [
  ['surface0', '--surface-0'],
  ['surface1', '--surface-1'],
  ['keyFace', '--key-face'],
  ['hairline', '--hairline'],
  ['ink1', '--ink-1'],
  ['ink2', '--ink-2'],
  ['ink3', '--ink-3'],
  ['brass', '--brass'],
  ['stThinking', '--st-thinking'],
  ['stWorking', '--st-working'],
  ['stWaiting', '--st-waiting'],
  ['stDone', '--st-done'],
  ['stError', '--st-error'],
  ['stIdle', '--st-idle'],
];

/** Writes the theme onto :root; every color in the app reads these variables. */
export function applyTheme(
  tokens: ThemeTokens,
  root: HTMLElement = document.documentElement,
): void {
  for (const [key, variable] of VARIABLE_MAP) {
    root.style.setProperty(variable, String(tokens[key]));
  }
  root.style.setProperty('--noise-opacity', String(tokens.noise));
  root.style.colorScheme = tokens.name === 'workshop' ? 'light' : 'dark';
}

export function parseThemeJson(raw: string): ThemeTokens | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = { ...GRAPHITE, ...(value as Partial<ThemeTokens>) };
  const colors = VARIABLE_MAP.map(([key]) => candidate[key]);
  if (!colors.every((color) => typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color))) {
    return undefined;
  }
  if (typeof candidate.noise !== 'number' || candidate.noise < 0 || candidate.noise > 0.2) {
    return undefined;
  }
  return candidate;
}
