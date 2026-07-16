/*
 * The shared adapter contract (SPEC §9): every adapter is replayed from
 * recorded fixtures against a real Hub and must exhibit the same behavior —
 * normalized status transitions, permission round-trips, resume. CI never
 * needs API keys or installed CLIs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerMsg, Session, SessionStatus } from '@agentdeck/protocol';
import { describe, expect, it } from 'vitest';
import { Hub } from '../src/core/hub.js';

export function loadFixtureLines(name: string): string[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name);
  return readFileSync(path, 'utf8').trim().split('\n');
}

export interface ContractObservations {
  session: Session;
  events: ServerMsg[];
}

export interface AdapterContractDriver {
  name: string;
  playHappyPath(): Promise<ContractObservations>;
  /** Absent when the harness surface exposes no failure signal (Claude hooks). */
  playError?: () => Promise<ContractObservations>;
  /** False when the harness surface carries no usage data (Claude hooks). */
  emitsUsageStats?: boolean;
  /** Present when the adapter can put a real approval in front of the deck. */
  permission?: {
    approve(): Promise<{ adapterSawAllow: boolean; events: ServerMsg[] }>;
    deny(): Promise<{ adapterSawDeny: boolean }>;
  };
  /** Present when the adapter can resume a harness-native session. */
  resume?: () => Promise<{ usedNativeId: boolean }>;
}

export function observedHub(): { hub: Hub; events: ServerMsg[] } {
  const hub = new Hub({ version: '1.0.0-contract' });
  const events: ServerMsg[] = [];
  hub.bus.on('broadcast', (msg) => events.push(msg));
  return { hub, events };
}

export function statusSequence(events: ServerMsg[]): SessionStatus[] {
  return events.flatMap((msg) =>
    msg.type === 'event' && msg.payload.kind === 'status' ? [msg.payload.status] : [],
  );
}

export function runAdapterContract(driver: AdapterContractDriver): void {
  describe(`adapter contract: ${driver.name}`, () => {
    it('plays the happy path: registers, works, finishes done with stats', async () => {
      const obs = await driver.playHappyPath();
      expect(obs.session.id.length).toBeGreaterThan(0);

      const statuses = statusSequence(obs.events);
      expect(statuses).toContain('working');
      expect(statuses.at(-1)).toBe('done');

      if (driver.emitsUsageStats !== false) {
        const stats = obs.events.flatMap((msg) =>
          msg.type === 'event' && msg.payload.kind === 'stats' ? [msg.payload.stats] : [],
        );
        expect(stats.length).toBeGreaterThan(0);
        expect(stats.at(-1)?.outputTokens).toBeGreaterThan(0);
      }

      const toolPhases = obs.events.flatMap((msg) =>
        msg.type === 'event' && msg.payload.kind === 'tool' ? [msg.payload.phase] : [],
      );
      expect(toolPhases.filter((phase) => phase === 'start').length).toBe(
        toolPhases.filter((phase) => phase === 'end').length,
      );
      expect(toolPhases.length).toBeGreaterThan(0);
    });

    if (driver.playError) {
      const playError = driver.playError;
      it('surfaces failures as an error status with an error notice', async () => {
        const obs = await playError();
        expect(statusSequence(obs.events).at(-1)).toBe('error');
        const errorNotices = obs.events.filter(
          (msg) =>
            msg.type === 'event' && msg.payload.kind === 'notice' && msg.payload.level === 'error',
        );
        expect(errorNotices.length).toBeGreaterThan(0);
      });
    }

    if (driver.permission) {
      const permission = driver.permission;
      it('routes a deck approval back to the harness', async () => {
        const result = await permission.approve();
        expect(result.adapterSawAllow).toBe(true);
        expect(result.events.some((msg) => msg.type === 'permission_request')).toBe(true);
        expect(result.events.some((msg) => msg.type === 'permission_resolved')).toBe(true);
      });

      it('routes a deck denial back to the harness', async () => {
        const result = await permission.deny();
        expect(result.adapterSawDeny).toBe(true);
      });
    } else {
      it('declares honestly that it cannot route approvals', async () => {
        const obs = await driver.playHappyPath();
        expect(obs.session.capabilities).not.toContain('approve');
      });
    }

    if (driver.resume) {
      const resume = driver.resume;
      it('resumes with the harness-native session id', async () => {
        const result = await resume();
        expect(result.usedNativeId).toBe(true);
      });
    }
  });
}
