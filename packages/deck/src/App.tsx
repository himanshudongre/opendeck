import { useEffect, useRef } from 'react';
import { DeskglowEdges } from './components/Deskglow.js';
import { controller } from './lib/controller.js';
import { acquireWakeLock, type WakeLockHandle } from './lib/wakelock.js';
import { activeTheme, useDeck } from './state/store.js';
import { applyTheme } from './state/themes.js';
import { FocusScreen } from './screens/FocusScreen.js';
import { GridScreen } from './screens/GridScreen.js';
import { PairScreen } from './screens/PairScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { ThemeEditorScreen } from './screens/ThemeEditorScreen.js';

export function App() {
  const screen = useDeck((state) => state.screen);
  const connection = useDeck((state) => state.connection);
  const sessions = useDeck((state) => state.sessions);

  useEffect(() => {
    applyTheme(activeTheme(useDeck.getState().settings));
    void controller.init();
  }, []);

  // `#focus=<sessionId>` deep-links straight into a session once it exists.
  const focusTarget = useRef(/#focus=([\w-]+)/.exec(window.location.hash)?.[1]);
  useEffect(() => {
    const target = focusTarget.current;
    if (target !== undefined && sessions[target] !== undefined) {
      focusTarget.current = undefined;
      history.replaceState(null, '', window.location.pathname);
      useDeck.getState().focusSession(target);
      controller.subscribe(target);
    }
  }, [sessions]);

  // A peripheral never sleeps: re-acquire on visibility changes (SPEC §6).
  useEffect(() => {
    let handle: WakeLockHandle | undefined;
    const acquire = (): void => {
      void acquireWakeLock().then((next) => {
        handle?.release();
        handle = next;
      });
    };
    acquire();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      handle?.release();
    };
  }, []);

  return (
    <div className="slab-noise relative h-full" style={{ background: 'var(--surface-0)' }}>
      <DeskglowEdges />
      <div className="relative z-10 flex h-full flex-col">
        {connection === 'reconnecting' && screen !== 'settings' && (
          <div
            role="status"
            className="notice-waiting pulse-waiting px-4 py-1 text-center text-[11px]"
          >
            Reconnecting to the hub…
          </div>
        )}
        <div className="min-h-0 flex-1">
          {connection === 'unpaired' ? (
            <PairScreen />
          ) : screen === 'focus' ? (
            <FocusScreen />
          ) : screen === 'settings' ? (
            <SettingsScreen />
          ) : screen === 'themes' ? (
            <ThemeEditorScreen />
          ) : (
            <GridScreen />
          )}
        </div>
      </div>
    </div>
  );
}
