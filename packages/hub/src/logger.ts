/*
 * The only module allowed to talk to stdout/stderr. Structured logs go to
 * pino (file under ~/.agentdeck/logs plus pretty stderr in dev); human-facing
 * terminal output (banner, QR, pairing notices) goes through `term`.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';
import { logsDir } from './paths.js';

let root: Logger | undefined;

export function logger(): Logger {
  if (!root) {
    const dir = logsDir();
    mkdirSync(dir, { recursive: true });
    root = pino(
      { level: process.env.AGENTDECK_LOG_LEVEL ?? 'info' },
      pino.destination({ dest: join(dir, 'hub.log'), mkdir: true, sync: false }),
    );
  }
  return root;
}

/** Terminal output for humans. Kept apart from logs so piping stays clean. */
export const term = {
  line(text = ''): void {
    process.stdout.write(`${text}\n`);
  },
  error(text: string): void {
    process.stderr.write(`${text}\n`);
  },
};
