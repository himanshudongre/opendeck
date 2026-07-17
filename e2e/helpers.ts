import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { Session } from '@opendeck/protocol';
import type { HubsState } from './global-setup.js';

/**
 * Navigate with the grid layout pinned: micro is the product default, but
 * these viewport suites assert the grid; micro has its own unit coverage.
 */
export async function openDeck(page: Page, url: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'opendeck.layout',
      JSON.stringify({
        preset: 'phone-portrait',
        tileSize: 'M',
        widgets: {
          statBar: true,
          ticker: true,
          actionKeys: true,
          dial: true,
          jogPad: false,
          voiceKey: true,
        },
        actionKeys: [
          { id: 'approve', label: 'Approve', kind: 'approve', accent: 'done' },
          { id: 'deny', label: 'Deny', kind: 'deny', accent: 'error' },
        ],
      }),
    );
  });
  await page.goto(url);
}

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
        __OPENDECK_STORE__: { getState: () => DeckSnapshot };
      }
    ).__OPENDECK_STORE__;
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
