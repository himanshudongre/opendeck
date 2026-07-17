import { X } from 'lucide-react';
import type { LayoutPreset, TileSize, WidgetVisibility } from '../state/layouts.js';
import { useDeck } from '../state/store.js';

const PRESET_LABELS: Record<LayoutPreset, string> = {
  micro: 'Micro (device)',
  'phone-portrait': 'Phone portrait',
  'phone-landscape': 'Phone landscape',
  tablet: 'Tablet',
  'desktop-strip': 'Desktop strip',
};

const WIDGET_LABELS: Record<keyof WidgetVisibility, string> = {
  statBar: 'Stat bar',
  ticker: 'Ticker',
  actionKeys: 'Action keys',
  dial: 'Dial',
  jogPad: 'Jog pad',
  voiceKey: 'Voice key',
};

/** Long-press edit mode: presets, widget toggles, tile size (SPEC §6). */
export function EditOverlay() {
  const layout = useDeck((state) => state.layout);
  const setLayoutPreset = useDeck((state) => state.setLayoutPreset);
  const updateLayout = useDeck((state) => state.updateLayout);
  const setTileSize = useDeck((state) => state.setTileSize);
  const setEditMode = useDeck((state) => state.setEditMode);
  const setScreen = useDeck((state) => state.setScreen);

  return (
    <div className="panel fixed inset-x-3 bottom-3 z-40 max-h-[60%] overflow-y-auto p-4 shadow-2xl">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm text-ink-1">Edit deck</h2>
        <button
          type="button"
          aria-label="Leave edit mode"
          className="keycap p-1.5"
          onClick={() => setEditMode(false)}
        >
          <X aria-hidden size={13} style={{ color: 'var(--ink-2)' }} />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ink-3">
        Use the arrows on each tile to reorder. Layouts and themes export from Settings.
      </p>
      <button
        type="button"
        className="keycap mt-2 px-3 py-1.5 text-xs text-ink-1"
        onClick={() => {
          setEditMode(false);
          setScreen('settings');
        }}
      >
        Open settings
      </button>

      <h3 className="font-data mt-4 text-[10px] uppercase tracking-wider text-ink-3">Layout</h3>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {(Object.keys(PRESET_LABELS) as LayoutPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            className="keycap px-3 py-2 text-left text-xs"
            style={layout.preset === preset ? { borderColor: 'var(--brass)' } : {}}
            onClick={() => setLayoutPreset(preset)}
          >
            <span className="text-ink-1">{PRESET_LABELS[preset]}</span>
          </button>
        ))}
      </div>

      <h3 className="font-data mt-4 text-[10px] uppercase tracking-wider text-ink-3">Tile size</h3>
      <div className="mt-1.5 flex gap-1.5">
        {(['S', 'M', 'L'] as TileSize[]).map((size) => (
          <button
            key={size}
            type="button"
            className="keycap flex-1 py-2 text-xs text-ink-1"
            style={layout.tileSize === size ? { borderColor: 'var(--brass)' } : {}}
            onClick={() => setTileSize(size)}
          >
            {size}
          </button>
        ))}
      </div>

      <h3 className="font-data mt-4 text-[10px] uppercase tracking-wider text-ink-3">Widgets</h3>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {(Object.keys(WIDGET_LABELS) as (keyof WidgetVisibility)[]).map((widget) => (
          <label
            key={widget}
            className="keycap flex items-center gap-2 px-3 py-2 text-xs text-ink-1"
          >
            <input
              type="checkbox"
              checked={layout.widgets[widget]}
              onChange={(event) =>
                updateLayout({ widgets: { ...layout.widgets, [widget]: event.target.checked } })
              }
            />
            {WIDGET_LABELS[widget]}
          </label>
        ))}
      </div>
    </div>
  );
}
