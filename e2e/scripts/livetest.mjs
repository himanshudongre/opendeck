// The real thing: a live Claude session controlled from the deck in a
// browser. Spawns the actual hub (no simulator), presses the device's
// new-session key, prompts Claude to write a file, approves the Write
// permission with the ✓ key, and asserts the file landed on disk.
//
// Needs the `claude` CLI installed and authenticated — run locally, not CI.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
const URL = 'http://127.0.0.1:3402';
const out = (line) => process.stdout.write(`${line}\n`);

const home = mkdtempSync(join(tmpdir(), 'opendeck-live-home-'));
const workdir = mkdtempSync(join(tmpdir(), 'opendeck-live-work-'));
const hub = spawn(
  process.execPath,
  [join(root, 'packages/hub/dist/cli.js'), '--localhost-only', '--no-auth', '--port', '3402'],
  {
    cwd: workdir,
    env: {
      ...process.env,
      PATH: `${join(homedir(), '.local', 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      OPENDECK_HOME: home,
    },
    stdio: 'ignore',
  },
);

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${URL}/api/health`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('hub never became healthy');
}

const fail = (msg) => {
  throw new Error(msg);
};

try {
  await waitForHealth();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(URL);
  await page.getByRole('slider').waitFor({ timeout: 30_000 });

  const store = () => page.evaluate(() => globalThis.__OPENDECK_STORE__.getState());

  // 1 — press the device's new-session key: a real `claude` process spawns.
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Start a new Claude session' }).click();
  await page.waitForFunction(
    () => Object.keys(globalThis.__OPENDECK_STORE__.getState().sessions).length > 0,
    null,
    { timeout: 30_000 },
  );
  out(`PASS session spawned from the deck in ${String(Date.now() - t0)} ms`);

  // 2 — its status must be live on the agent key (not simulated).
  const first = await store();
  const sessionId = Object.keys(first.sessions)[0];
  const title = first.sessions[sessionId].title;
  await page.getByRole('button', { name: new RegExp(title) }).waitFor({ timeout: 10_000 });
  out(`PASS agent key shows live session "${title}" (${first.sessions[sessionId].status})`);

  // 3 — open Focus and send a real prompt from the composer.
  await page.getByRole('button', { name: 'Open the selected agent' }).click();
  const composer = page.getByPlaceholder('Send a prompt');
  await composer.waitFor({ timeout: 10_000 });
  await composer.fill(
    'Create a file named DECK_TEST.txt containing exactly OK in the current directory. Do nothing else.',
  );
  await page.getByRole('button', { name: 'Send prompt' }).click();
  out('sent prompt; waiting for Claude to ask for Write permission…');

  // 4 — the Write permission must surface; approve it from the micro's ✓ key.
  await page.waitForFunction(
    () => Object.keys(globalThis.__OPENDECK_STORE__.getState().permissions).length > 0,
    null,
    { timeout: 120_000 },
  );
  const pend = await store();
  const toolName = Object.values(pend.permissions)[0].tool.name;
  out(`PASS live permission raised: ${toolName}`);
  await page.getByRole('button', { name: 'Back to the grid' }).click();
  const approveKey = page.getByRole('button', { name: `Approve ${toolName}` });
  await approveKey.waitFor({ timeout: 10_000 });
  const tApprove = Date.now();
  await approveKey.click();
  await page.waitForFunction(
    () => Object.keys(globalThis.__OPENDECK_STORE__.getState().permissions).length === 0,
    null,
    { timeout: 15_000 },
  );
  out(`PASS approved from the ✓ key; card cleared in ${String(Date.now() - tApprove)} ms`);

  // 5 — the file must actually exist on disk with the right contents.
  const target = join(workdir, 'DECK_TEST.txt');
  for (let i = 0; i < 120; i += 1) {
    if (existsSync(target)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!existsSync(target)) fail('DECK_TEST.txt never appeared on disk');
  const contents = readFileSync(target, 'utf8').trim();
  if (contents !== 'OK') fail(`DECK_TEST.txt contents wrong: ${contents}`);
  out('PASS Claude wrote DECK_TEST.txt with OK — full loop verified');

  // 6 — the session must settle back to a non-working status on the key.
  await page.waitForFunction(
    () => {
      const state = globalThis.__OPENDECK_STORE__.getState();
      const session = Object.values(state.sessions)[0];
      return session && session.status !== 'working' && session.status !== 'thinking';
    },
    null,
    { timeout: 120_000 },
  );
  const final = await store();
  out(
    `PASS status settled: ${Object.values(final.sessions)[0].status} · ws latency ${String(final.latencyMs ?? '?')} ms`,
  );

  await browser.close();
  out('livetest done');
} finally {
  hub.kill('SIGTERM');
  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
}
