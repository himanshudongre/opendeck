import { describe, expect, it } from 'vitest';
import { gridColumns, LAYOUT_PRESETS } from '../src/state/layouts.js';
import {
  GRAPHITE,
  PRESET_THEMES,
  VOID,
  WORKSHOP,
  applyTheme,
  parseThemeJson,
} from '../src/state/themes.js';

describe('applyTheme', () => {
  it('writes every token as a CSS variable on :root', () => {
    const root = document.createElement('div');
    applyTheme(GRAPHITE, root);
    expect(root.style.getPropertyValue('--surface-0')).toBe('#0E0F12');
    expect(root.style.getPropertyValue('--brass')).toBe('#D8B36A');
    expect(root.style.getPropertyValue('--st-waiting')).toBe('#FFB454');
    expect(root.style.getPropertyValue('--noise-opacity')).toBe('0.02');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('switches color-scheme for the cream Workshop slab', () => {
    const root = document.createElement('div');
    applyTheme(WORKSHOP, root);
    expect(root.style.getPropertyValue('--surface-0')).toBe('#EDE6D6');
    expect(root.style.colorScheme).toBe('light');
  });

  it('ships the three presets with distinct slabs', () => {
    expect(Object.keys(PRESET_THEMES)).toEqual(['graphite', 'workshop', 'void']);
    expect(new Set([GRAPHITE.surface0, WORKSHOP.surface0, VOID.surface0]).size).toBe(3);
    expect(VOID.surface0).toBe('#000000');
  });
});

describe('parseThemeJson', () => {
  it('round-trips an exported theme', () => {
    const parsed = parseThemeJson(JSON.stringify(WORKSHOP));
    expect(parsed).toEqual(WORKSHOP);
  });

  it('fills missing fields from Graphite', () => {
    const parsed = parseThemeJson(JSON.stringify({ brass: '#ffcc00' }));
    expect(parsed?.brass).toBe('#ffcc00');
    expect(parsed?.surface0).toBe(GRAPHITE.surface0);
  });

  it('rejects garbage, bad colors, and silly noise values', () => {
    expect(parseThemeJson('not json')).toBeUndefined();
    expect(parseThemeJson('42')).toBeUndefined();
    expect(parseThemeJson(JSON.stringify({ brass: 'gold' }))).toBeUndefined();
    expect(parseThemeJson(JSON.stringify({ noise: 5 }))).toBeUndefined();
  });
});

describe('layouts', () => {
  it('ships the four presets from the spec', () => {
    expect(Object.keys(LAYOUT_PRESETS)).toEqual([
      'phone-portrait',
      'phone-landscape',
      'tablet',
      'desktop-strip',
    ]);
  });

  it('adjusts grid columns by preset and tile size', () => {
    expect(gridColumns('phone-portrait', 'M')).toBe(2);
    expect(gridColumns('phone-portrait', 'S')).toBe(3);
    expect(gridColumns('phone-portrait', 'L')).toBe(1);
    expect(gridColumns('desktop-strip', 'S')).toBe(7);
    expect(gridColumns('tablet', 'L')).toBe(2);
  });
});
