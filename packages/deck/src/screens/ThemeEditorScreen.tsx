import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { activeTheme, useDeck } from '../state/store.js';
import {
  GRAPHITE,
  PRESET_THEMES,
  applyTheme,
  parseThemeJson,
  type ThemeTokens,
} from '../state/themes.js';

const TOKEN_FIELDS: { key: keyof ThemeTokens; label: string }[] = [
  { key: 'surface0', label: 'Slab' },
  { key: 'surface1', label: 'Panel' },
  { key: 'keyFace', label: 'Keycap' },
  { key: 'hairline', label: 'Hairline' },
  { key: 'ink1', label: 'Ink 1' },
  { key: 'ink2', label: 'Ink 2' },
  { key: 'ink3', label: 'Ink 3' },
  { key: 'brass', label: 'Brass' },
  { key: 'stThinking', label: 'Thinking' },
  { key: 'stWorking', label: 'Working' },
  { key: 'stWaiting', label: 'Waiting' },
  { key: 'stDone', label: 'Done' },
  { key: 'stError', label: 'Error' },
  { key: 'stIdle', label: 'Idle' },
];

/** Token-level editing with live preview and JSON export/import (SPEC §6). */
export function ThemeEditorScreen() {
  const settings = useDeck((state) => state.settings);
  const setTheme = useDeck((state) => state.setTheme);
  const setScreen = useDeck((state) => state.setScreen);
  const [draft, setDraft] = useState<ThemeTokens>({ ...activeTheme(settings) });
  const [importText, setImportText] = useState('');
  const [note, setNote] = useState<string | undefined>(undefined);

  const update = (key: keyof ThemeTokens, value: string): void => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    applyTheme(next);
  };

  const save = (): void => {
    setTheme(draft);
    setNote('Saved as your custom theme.');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          aria-label="Back to settings"
          className="keycap p-2"
          onClick={() => {
            applyTheme(activeTheme(useDeck.getState().settings));
            setScreen('settings');
          }}
        >
          <ArrowLeft aria-hidden size={14} style={{ color: 'var(--ink-2)' }} />
        </button>
        <h2 className="font-display text-sm text-ink-1">Theme editor</h2>
        <button
          type="button"
          className="keycap ml-auto px-3 py-1.5 text-xs text-ink-1"
          onClick={save}
        >
          Save theme
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3">
        <div className="panel mb-4 px-4 py-3">
          <p className="font-display text-xs text-ink-1">Live preview</p>
          <p className="font-data mt-1 text-[11px] text-ink-2">
            Colors apply as you pick them. Leaving without saving reverts.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {TOKEN_FIELDS.map(({ key, label }) => (
            <label key={key} className="keycap flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[11px] text-ink-1">{label}</span>
              <input
                type="color"
                aria-label={`${label} color`}
                value={String(draft[key])}
                className="h-6 w-9 cursor-pointer border-0 bg-transparent p-0"
                onChange={(event) => update(key, event.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="mt-4 flex gap-1.5">
          {Object.keys(PRESET_THEMES).map((name) => (
            <button
              key={name}
              type="button"
              className="keycap flex-1 py-2 text-[11px] text-ink-1"
              onClick={() => {
                const preset = PRESET_THEMES[name] ?? GRAPHITE;
                setDraft({ ...preset });
                applyTheme(preset);
              }}
            >
              Reset to {name}
            </button>
          ))}
        </div>

        <h3 className="font-data mt-6 text-[10px] uppercase tracking-wider text-ink-3">Export</h3>
        <pre className="keycap font-data mt-1.5 max-h-40 select-text overflow-auto px-3 py-2 text-[10px] text-ink-2">
          {JSON.stringify(draft, null, 2)}
        </pre>
        <button
          type="button"
          className="keycap mt-1.5 px-3 py-1.5 text-[11px] text-ink-1"
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(draft, null, 2)).then(() => {
              setNote('Theme JSON copied.');
            });
          }}
        >
          Copy JSON
        </button>

        <h3 className="font-data mt-6 text-[10px] uppercase tracking-wider text-ink-3">Import</h3>
        <textarea
          aria-label="Paste theme JSON"
          value={importText}
          placeholder="Paste theme JSON"
          className="keycap font-data mt-1.5 h-24 w-full px-3 py-2 text-[11px] text-ink-1 placeholder:text-ink-3"
          onChange={(event) => setImportText(event.target.value)}
        />
        <button
          type="button"
          className="keycap mt-1.5 px-3 py-1.5 text-[11px] text-ink-1"
          onClick={() => {
            const parsed = parseThemeJson(importText);
            if (!parsed) {
              setNote('That JSON isn’t a valid theme. Nothing changed.');
              return;
            }
            setDraft(parsed);
            applyTheme(parsed);
            setNote('Theme imported. Save to keep it.');
          }}
        >
          Import
        </button>

        {note !== undefined && <p className="mt-3 text-[11px] text-ink-2">{note}</p>}
      </div>
    </div>
  );
}
