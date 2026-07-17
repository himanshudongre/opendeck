// Generates the README media against `agentdeck --demo` (SPEC §10):
// Graphite phone + Workshop tablet screenshots, a focus/permission hero shot,
// and the demo GIF (recorded video → ffmpeg palette GIF).
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const cliPath = join(repoRoot, 'packages', 'hub', 'dist', 'cli.js');
const docsDir = join(repoRoot, 'docs');
const scratch = join(here, '..', '.state', 'shots');

const PORT = 3348;
const URL = `http://127.0.0.1:${PORT}`;
const out = (line) => process.stdout.write(`${line}\n`);

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`${URL}/api/health`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('hub never became healthy');
}

function startHub(speed) {
  return spawn(
    process.execPath,
    [cliPath, '--demo', '--localhost-only', '--no-auth', '--port', String(PORT)],
    {
      env: {
        ...process.env,
        OPENDECK_HOME: join(scratch, `home-${String(speed)}`),
        OPENDECK_SIM_SPEED: String(speed),
        OPENDECK_SIM_SEED: '7',
      },
      stdio: 'ignore',
    },
  );
}

async function waitForTile(page, name, timeout = 30_000) {
  await page.getByRole('button', { name }).first().waitFor({ timeout });
}

async function waitForTileText(page, name, text, timeout = 30_000) {
  await page.getByRole('button', { name }).filter({ hasText: text }).first().waitFor({ timeout });
}

async function screenshots() {
  const hub = startHub(6);
  await waitForHealth();
  const browser = await chromium.launch();
  try {
    // Graphite, phone portrait: catch the grid with amber waiting states.
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await phone.addInitScript(() => {
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
            { id: 'interrupt', label: 'Interrupt', kind: 'interrupt', accent: 'waiting' },
          ],
        }),
      );
    });
    const phonePage = await phone.newPage();
    await phonePage.goto(URL);
    await waitForTileText(phonePage, /fix flaky auth test/, 'needs approval');
    await waitForTileText(phonePage, /tune retrieval evals/, 'error');
    await phonePage.screenshot({ path: join(docsDir, 'deck-graphite-phone.png') });
    out('wrote docs/deck-graphite-phone.png');

    // Focus + permission card: the hero flow.
    await phonePage.getByRole('button', { name: /speed up invoice list/ }).click();
    await phonePage.getByText('Bash wants to run').waitFor();
    await phonePage.screenshot({ path: join(docsDir, 'deck-focus-permission.png') });
    out('wrote docs/deck-focus-permission.png');
    await phone.close();

    // Micro mode: the default experience — the WebGL device, no seeding.
    const micro = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const microPage = await micro.newPage();
    await microPage.goto(URL);
    await microPage.getByRole('slider').waitFor();
    // Give the lazy three.js chunk, PMREM env, and first frames time to land.
    await microPage.waitForTimeout(4000);
    await microPage.screenshot({ path: join(docsDir, 'deck-micro.png') });
    out('wrote docs/deck-micro.png');
    await micro.close();

    // Micro in Workshop: the cream hardware homage.
    const cream = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await cream.addInitScript(() => {
      localStorage.setItem(
        'opendeck.settings',
        JSON.stringify({
          themeName: 'workshop',
          sound: 'clicky',
          haptics: true,
          leftHand: false,
          voiceLang: 'en-US',
          rendering: 'classic',
        }),
      );
    });
    const creamPage = await cream.newPage();
    await creamPage.goto(URL);
    await creamPage.getByRole('slider').waitFor();
    await creamPage.waitForTimeout(4000);
    await creamPage.screenshot({ path: join(docsDir, 'deck-micro-cream.png') });
    out('wrote docs/deck-micro-cream.png');
    await cream.close();

    // Micro on a tablet: the device scales up and gains a third agent row.
    const microTablet = await browser.newContext({
      viewport: { width: 1180, height: 820 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await microTablet.addInitScript(() => {
      localStorage.setItem(
        'opendeck.settings',
        JSON.stringify({
          themeName: 'workshop',
          sound: 'clicky',
          haptics: true,
          leftHand: false,
          voiceLang: 'en-US',
          rendering: 'classic',
        }),
      );
    });
    const microTabletPage = await microTablet.newPage();
    await microTabletPage.goto(URL);
    await microTabletPage.getByRole('slider').waitFor();
    await microTabletPage.waitForTimeout(2500);
    await microTabletPage.screenshot({ path: join(docsDir, 'deck-micro-tablet.png') });
    out('wrote docs/deck-micro-tablet.png');
    await microTablet.close();

    // Workshop, tablet: the cream slab homage.
    const tablet = await browser.newContext({
      viewport: { width: 1180, height: 820 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await tablet.addInitScript(() => {
      localStorage.setItem(
        'opendeck.settings',
        JSON.stringify({
          themeName: 'workshop',
          sound: 'clicky',
          haptics: true,
          leftHand: false,
          voiceLang: 'en-US',
        }),
      );
      localStorage.setItem(
        'opendeck.layout',
        JSON.stringify({
          preset: 'tablet',
          tileSize: 'M',
          widgets: {
            statBar: true,
            ticker: true,
            actionKeys: true,
            dial: true,
            jogPad: true,
            voiceKey: true,
          },
          actionKeys: [
            { id: 'approve', label: 'Approve', kind: 'approve', accent: 'done' },
            { id: 'deny', label: 'Deny', kind: 'deny', accent: 'error' },
            { id: 'interrupt', label: 'Interrupt', kind: 'interrupt', accent: 'waiting' },
          ],
        }),
      );
    });
    const tabletPage = await tablet.newPage();
    await tabletPage.goto(URL);
    await waitForTile(tabletPage, /fix flaky auth test/);
    await tabletPage.waitForTimeout(2500);
    await tabletPage.screenshot({ path: join(docsDir, 'deck-workshop-tablet.png') });
    out('wrote docs/deck-workshop-tablet.png');
    await tablet.close();
  } finally {
    await browser.close();
    hub.kill('SIGTERM');
  }
}

async function demoGif(themeName, gifName) {
  const hub = startHub(2);
  await waitForHealth();
  const browser = await chromium.launch();
  const videoDir = join(scratch, `video-${themeName}`);
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      recordVideo: { dir: videoDir, size: { width: 390, height: 844 } },
    });
    await context.addInitScript((theme) => {
      localStorage.setItem(
        'opendeck.settings',
        JSON.stringify({
          themeName: theme,
          sound: 'clicky',
          haptics: true,
          leftHand: false,
          voiceLang: 'en-US',
          rendering: 'classic',
        }),
      );
    }, themeName);
    const page = await context.newPage();
    await page.goto(URL);

    // Micro mode is the default: watch the LEDs come alive, approve the
    // hero permission with the ✓ key, watch the agent go green.
    await page.getByRole('slider').waitFor({ timeout: 40_000 });
    await page
      .getByText(/approve Edit\?/)
      .first()
      .waitFor({ timeout: 40_000 });
    await page.waitForTimeout(2600);
    await page.getByRole('button', { name: 'Approve Edit' }).dispatchEvent('click');
    await page.waitForTimeout(4500);

    await context.close();
    const video = page.video();
    const webm = video === null ? undefined : await video.path();
    if (webm === undefined) throw new Error('no video recorded');

    const gifPath = join(docsDir, gifName);
    const palette = join(scratch, `palette-${themeName}.png`);
    const filters = 'fps=12,scale=390:-1:flags=lanczos';
    let result = spawnSync('ffmpeg', ['-y', '-i', webm, '-vf', `${filters},palettegen`, palette]);
    if (result.status !== 0) throw new Error('ffmpeg palettegen failed');
    result = spawnSync('ffmpeg', [
      '-y',
      '-i',
      webm,
      '-i',
      palette,
      '-lavfi',
      `${filters} [x]; [x][1:v] paletteuse`,
      gifPath,
    ]);
    if (result.status !== 0) throw new Error('ffmpeg paletteuse failed');
    out(`wrote docs/${gifName}`);
  } finally {
    await browser.close();
    hub.kill('SIGTERM');
  }
}

mkdirSync(docsDir, { recursive: true });
mkdirSync(scratch, { recursive: true });
await screenshots();
await demoGif('graphite', 'demo.gif');
await demoGif('workshop', 'demo-cream.gif');
rmSync(scratch, { recursive: true, force: true });
out('done');
