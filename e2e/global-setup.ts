import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boots two built hubs:
 *  - an open one (--no-auth) driving most suites at high simulator speed
 *  - an authenticated one whose printed QR token feeds the pairing test
 * State lands in .state/hubs.json for the tests; teardown kills both.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, '..', 'packages', 'hub', 'dist', 'cli.js');
const statePath = join(here, '.state', 'hubs.json');

export interface HubsState {
  openUrl: string;
  authUrl: string;
  pairToken: string;
  pids: number[];
}

function startHubProcess(
  args: string[],
  home: string,
): { child: ChildProcess; output: () => string } {
  let output = '';
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      AGENTDECK_HOME: home,
      AGENTDECK_SIM_SPEED: '12',
      AGENTDECK_SIM_SEED: '7',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  return { child, output: () => output };
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(dirname(statePath), { recursive: true });
  const stateDir = dirname(statePath);

  const open = startHubProcess(
    ['--demo', '--localhost-only', '--no-auth', '--port', '3341'],
    join(stateDir, 'home-open'),
  );
  const auth = startHubProcess(
    ['--demo', '--localhost-only', '--port', '3342'],
    join(stateDir, 'home-auth'),
  );

  const openUrl = 'http://127.0.0.1:3341';
  const authUrl = 'http://127.0.0.1:3342';

  await waitFor(() => open.output().includes('Deck ready'), 'open hub banner');
  await waitFor(() => auth.output().includes('#pair='), 'pairing token in auth hub banner');
  for (;;) {
    if ((await healthy(openUrl)) && (await healthy(authUrl))) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const tokenMatch = /#pair=([A-Za-z0-9_-]+)/.exec(auth.output());
  if (!tokenMatch?.[1]) throw new Error('auth hub printed no pairing token');

  const state: HubsState = {
    openUrl,
    authUrl,
    pairToken: tokenMatch[1],
    pids: [open.child.pid ?? 0, auth.child.pid ?? 0],
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
