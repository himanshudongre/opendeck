import './lib/compat.js';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { primeSwitchSounds } from './lib/switch-sounds.js';
import { useDeck } from './state/store.js';

// Debugging/E2E surface: lets a console or Playwright read the live store.
(globalThis as Record<string, unknown>).__OPENDECK_STORE__ = useDeck;

// Arm the user's imported switch recording before the first press.
if (useDeck.getState().settings.sound === 'custom') {
  void primeSwitchSounds();
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('OpenDeck: #root element missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
