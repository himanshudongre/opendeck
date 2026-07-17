import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { Session } from '@agentdeck/protocol';
import type { HubsState } from './global-setup.js';

export function hubs(): HubsState {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, '.state', 'hubs.json'), 'utf8')) as HubsState;
}

export interface DeckSnapshot {
  connection: string;
  lastSeq: number;
  lastResume: string | undefined;
  sessions: Record<string, Session>;
  permissions: Record<string, { id: string; sessionId: string }>;
}

/** Reads the live zustand store through the deck's debugging surface. */
export function deckState(page: Page): Promise<DeckSnapshot> {
  return page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        __AGENTDECK_STORE__: { getState: () => DeckSnapshot };
      }
    ).__AGENTDECK_STORE__;
    const state = store.getState();
    return {
      connection: state.connection,
      lastSeq: state.lastSeq,
      lastResume: state.lastResume,
      sessions: state.sessions,
      permissions: state.permissions,
    };
  });
}

export async function hubSnapshot(url: string): Promise<{ sessions: Session[]; seq: number }> {
  const res = await fetch(`${url}/api/snapshot`);
  if (!res.ok) throw new Error(`snapshot failed: ${String(res.status)}`);
  return (await res.json()) as { sessions: Session[]; seq: number };
}
