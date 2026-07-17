import type { Action, PermissionResolution, SetEffortPayload } from '@opendeck/protocol';
import { useDeck } from '../state/store.js';
import { DeckConnection, type Credentials } from './connection.js';
import {
  clearPairing,
  deviceName,
  pairWithToken,
  pairingTokenFromHash,
  readPairing,
} from './pairing.js';

/**
 * Glue between the socket and the store — widgets call these functions, the
 * store stays a pure fold of server messages.
 */
class DeckController {
  private connection: DeckConnection | undefined;

  baseUrl(): string {
    const configured = import.meta.env.VITE_HUB_URL as string | undefined;
    return configured ?? window.location.origin;
  }

  /** Boot flow: consume a #pair token, else stored credentials, else unpaired. */
  async init(): Promise<void> {
    const store = useDeck.getState();
    const token = pairingTokenFromHash(window.location.hash);
    if (token !== undefined) {
      // Scrub the one-time token from the URL and browser history right away.
      history.replaceState(null, '', window.location.pathname);
      const result = await pairWithToken(this.baseUrl(), token, deviceName(navigator.userAgent));
      if (!result.ok) {
        store.setConnection('unpaired');
        store.pushTickerNote('error', result.message);
        return;
      }
      this.connect(result.pairing);
      return;
    }

    const stored = readPairing();
    if (stored) {
      this.connect(stored);
      return;
    }

    // A hub running --no-auth answers the snapshot without credentials:
    // connect straight away instead of demanding a pairing that can't exist.
    try {
      const probe = await fetch(`${this.baseUrl()}/api/snapshot`);
      if (probe.ok) {
        this.connect(undefined);
        return;
      }
    } catch {
      // Hub unreachable: the pair screen explains the next step either way.
    }
    store.setConnection('unpaired');
  }

  connect(credentials: Credentials | undefined): void {
    this.connection?.stop();
    const store = useDeck.getState();
    store.setConnection('reconnecting');
    this.connection = new DeckConnection(this.baseUrl(), credentials, {
      onMsg: (msg) => {
        useDeck.getState().applyServerMsg(msg);
      },
      onState: (state) => {
        useDeck.getState().setConnection(state);
      },
      onLatency: (ms) => {
        useDeck.getState().setLatency(ms);
      },
    });
    this.connection.start();
  }

  unpair(): void {
    this.connection?.stop();
    this.connection = undefined;
    clearPairing();
    useDeck.getState().reset();
    useDeck.getState().setConnection('unpaired');
  }

  action(action: Action): void {
    this.connection?.send('action', action);
  }

  respondPermission(requestId: string, resolution: PermissionResolution): void {
    this.connection?.send('permission_response', { requestId, resolution });
  }

  prompt(sessionId: string, text: string): void {
    this.connection?.send('prompt', { sessionId, text });
  }

  voicePrompt(sessionId: string, text: string, lang: string): void {
    this.connection?.send('voice_prompt', { sessionId, text, lang });
  }

  setEffort(payload: SetEffortPayload): void {
    this.connection?.send('set_effort', payload);
  }

  /** Focus opened/closed: only the focused session streams transcripts. */
  subscribe(sessionId: string | null): void {
    this.connection?.send('subscribe', { sessionId });
  }
}

export const controller = new DeckController();
