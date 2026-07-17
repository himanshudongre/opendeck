import { ArrowLeft } from 'lucide-react';
import { controller } from '../lib/controller.js';
import type { SoundPreset } from '../lib/sound.js';
import { PRESET_THEMES } from '../state/themes.js';
import { useDeck } from '../state/store.js';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="hairline-b flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-[13px] text-ink-1">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="keycap px-2.5 py-1 text-[11px] text-ink-1"
      style={active ? { borderColor: 'var(--brass)' } : {}}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function SettingsScreen() {
  const settings = useDeck((state) => state.settings);
  const updateSettings = useDeck((state) => state.updateSettings);
  const setScreen = useDeck((state) => state.setScreen);
  const setTheme = useDeck((state) => state.setTheme);
  const hubVersion = useDeck((state) => state.hubVersion);

  const httpsUrl = ((): string => {
    const url = new URL(window.location.origin);
    url.protocol = 'https:';
    url.port = '3326';
    return url.toString();
  })();

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          aria-label="Back to the grid"
          className="keycap p-2"
          onClick={() => setScreen('grid')}
        >
          <ArrowLeft aria-hidden size={14} style={{ color: 'var(--ink-2)' }} />
        </button>
        <h2 className="font-display text-sm text-ink-1">Settings</h2>
        {hubVersion !== undefined && (
          <span className="font-data ml-auto text-[10px] text-ink-3">hub v{hubVersion}</span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        <h3 className="font-data px-4 pb-1 pt-4 text-[10px] uppercase tracking-wider text-ink-3">
          Appearance
        </h3>
        <Row label="Theme">
          {Object.keys(PRESET_THEMES).map((name) => {
            const preset = PRESET_THEMES[name];
            if (!preset) return null;
            return (
              <Chip
                key={name}
                label={name}
                active={settings.themeName === name && settings.customTheme === undefined}
                onClick={() => setTheme(preset, name)}
              />
            );
          })}
          <Chip
            label="edit…"
            active={settings.customTheme !== undefined}
            onClick={() => setScreen('themes')}
          />
        </Row>
        <Row label="Left-hand mode">
          <Chip
            label={settings.leftHand ? 'on' : 'off'}
            active={settings.leftHand}
            onClick={() => updateSettings({ leftHand: !settings.leftHand })}
          />
        </Row>

        <h3 className="font-data px-4 pb-1 pt-4 text-[10px] uppercase tracking-wider text-ink-3">
          Feel
        </h3>
        <Row label="Key sound">
          {(['clicky', 'silent', 'off'] as SoundPreset[]).map((preset) => (
            <Chip
              key={preset}
              label={preset}
              active={settings.sound === preset}
              onClick={() => updateSettings({ sound: preset })}
            />
          ))}
        </Row>
        <Row label="Haptics">
          <Chip
            label={settings.haptics ? 'on' : 'off'}
            active={settings.haptics}
            onClick={() => updateSettings({ haptics: !settings.haptics })}
          />
        </Row>

        <h3 className="font-data px-4 pb-1 pt-4 text-[10px] uppercase tracking-wider text-ink-3">
          Voice
        </h3>
        <Row label="Language">
          {['en-US', 'en-GB', 'de-DE', 'ja-JP'].map((lang) => (
            <Chip
              key={lang}
              label={lang}
              active={settings.voiceLang === lang}
              onClick={() => updateSettings({ voiceLang: lang })}
            />
          ))}
        </Row>
        {!window.isSecureContext && (
          <div
            className="mx-4 mt-2 rounded-md px-3 py-2.5"
            style={{ background: 'var(--surface-1)' }}
          >
            <p className="font-display text-xs text-ink-1">Enable voice</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
              Browsers allow the microphone and screen wake lock only on secure connections. Open{' '}
              <a className="font-data underline" style={{ color: 'var(--brass)' }} href={httpsUrl}>
                {httpsUrl}
              </a>{' '}
              and accept the hub’s self-signed certificate once. Pairing carries over.
            </p>
          </div>
        )}

        <h3 className="font-data px-4 pb-1 pt-4 text-[10px] uppercase tracking-wider text-ink-3">
          This device
        </h3>
        <Row label="Unpair from this hub">
          <Chip
            label="unpair"
            active={false}
            onClick={() => {
              controller.unpair();
            }}
          />
        </Row>
        <p className="px-4 pt-2 text-[11px] leading-relaxed text-ink-3">
          Revoke other devices from the hub terminal with{' '}
          <code className="font-data">agent-deck devices revoke &lt;id&gt;</code>.
        </p>
      </div>
    </div>
  );
}
