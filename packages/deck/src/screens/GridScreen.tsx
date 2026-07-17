import { useDeck } from '../state/store.js';
import { gridColumns } from '../state/layouts.js';
import { AgentTile } from '../widgets/AgentTile.js';
import { ActionKey } from '../widgets/ActionKey.js';
import { Dial } from '../widgets/Dial.js';
import { JogPad } from '../widgets/JogPad.js';
import { StatBar } from '../widgets/StatBar.js';
import { Ticker } from '../widgets/Ticker.js';
import { VoiceKey } from '../widgets/VoiceKey.js';
import { EditOverlay } from './EditOverlay.js';

export function GridScreen() {
  const sessions = useDeck((state) => state.sessions);
  const order = useDeck((state) => state.order);
  const layout = useDeck((state) => state.layout);
  const editMode = useDeck((state) => state.editMode);
  const settings = useDeck((state) => state.settings);
  const setEditMode = useDeck((state) => state.setEditMode);

  const ordered = order.flatMap((id) => (sessions[id] ? [sessions[id]] : []));
  const columns = gridColumns(layout.preset, layout.tileSize);
  const sideRail = layout.preset === 'phone-landscape' || layout.preset === 'tablet';

  const physicalControls = layout.widgets.jogPad || layout.widgets.dial || layout.widgets.voiceKey;
  const controls = (
    <div
      className={sideRail ? 'flex h-full flex-col justify-end gap-3 px-3 py-3' : 'px-4 pb-3 pt-2.5'}
    >
      {layout.widgets.actionKeys && (
        <div className={`flex gap-2 ${sideRail ? 'flex-col' : ''}`}>
          {layout.actionKeys.map((binding) => (
            <ActionKey key={binding.id} binding={binding} />
          ))}
        </div>
      )}
      {physicalControls && (
        <div
          className={`flex items-end justify-center gap-5 ${
            sideRail ? 'flex-col items-center gap-3' : 'mt-2.5'
          } ${settings.leftHand && !sideRail ? 'flex-row-reverse' : ''}`}
        >
          {layout.widgets.jogPad && <JogPad />}
          {layout.widgets.dial && <Dial />}
          {layout.widgets.voiceKey && <VoiceKey />}
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex h-full ${sideRail ? 'flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {layout.widgets.statBar && <StatBar />}
        {layout.widgets.ticker && <Ticker />}

        <main
          className="min-h-0 flex-1 overflow-y-auto p-3"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && editMode) setEditMode(false);
          }}
        >
          {ordered.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="panel max-w-sm px-6 py-8 text-center">
                <p className="font-display text-sm text-ink-1">No agents yet.</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-2">
                  Start one in your terminal, or run{' '}
                  <code className="font-data" style={{ color: 'var(--brass)' }}>
                    agentdeck --demo
                  </code>{' '}
                  to see the deck in motion.
                </p>
              </div>
            </div>
          ) : (
            <div
              className="grid gap-2.5"
              style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
            >
              {ordered.map((session) => (
                <AgentTile key={session.id} session={session} size={layout.tileSize} />
              ))}
            </div>
          )}
        </main>

        {!sideRail && controls}
      </div>

      {sideRail && (
        <aside className="w-44 border-l" style={{ borderColor: 'var(--hairline)' }}>
          {controls}
        </aside>
      )}

      {editMode && <EditOverlay />}
    </div>
  );
}
