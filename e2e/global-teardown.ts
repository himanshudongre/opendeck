import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HubsState } from './global-setup.js';

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = join(here, '.state');

export default function globalTeardown(): void {
  try {
    const state = JSON.parse(readFileSync(join(stateDir, 'hubs.json'), 'utf8')) as HubsState;
    for (const pid of state.pids) {
      if (pid > 0) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Already gone.
        }
      }
    }
  } catch {
    // No state file: nothing was started.
  }
  rmSync(stateDir, { recursive: true, force: true });
}
