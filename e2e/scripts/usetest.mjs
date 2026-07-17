// A user-perspective pass on the 3D micro: real pointer input against the
// WebGL hit-testing (no a11y shortcuts). Verifies approve-by-key, page
// swiping, and the knob's vertical drag.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
const URL = 'http://127.0.0.1:3399';
const out = (line) => process.stdout.write(`${line}\n`);

const home = mkdtempSync(join(tmpdir(), 'opendeck-usetest-'));
const hub = spawn(
  process.execPath,
  [join(root, 'packages/hub/dist/cli.js'), '--demo', '--no-auth', '--port', '3399'],
  { env: { ...process.env, OPENDECK_HOME: home }, stdio: 'ignore' },
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

/** Screen-space pixel position of a world point, via the live camera. */
async function screenPos(page, x, y, z) {
  return page.evaluate(
    ([wx, wy, wz]) => {
      const st = globalThis.__OPENDECK_SCENE__;
      const cam = st.camera;
      cam.updateMatrixWorld(true);
      const m = cam.matrixWorldInverse.elements;
      const p = cam.projectionMatrix.elements;
      const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
      const cy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
      const cz = m[2] * wx + m[6] * wy + m[10] * wz + m[14];
      const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
      const px = p[0] * cx + p[4] * cy + p[8] * cz + p[12] * cw;
      const py = p[1] * cx + p[5] * cy + p[9] * cz + p[13] * cw;
      const pw = p[3] * cx + p[7] * cy + p[11] * cz + p[15] * cw;
      const canvas = document.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      return [
        rect.left + ((px / pw + 1) / 2) * rect.width,
        rect.top + ((1 - py / pw) / 2) * rect.height,
      ];
    },
    [x, y, z],
  );
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
  await page.getByRole('slider').waitFor({ timeout: 40_000 });
  await page.waitForFunction(() => Boolean(globalThis.__OPENDECK_SCENE__), null, {
    timeout: 40_000,
  });
  await page.waitForTimeout(2500);

  const store = () => page.evaluate(() => globalThis.__OPENDECK_STORE__.getState());
  const zs = await page.evaluate(() => {
    const s = globalThis.__OPENDECK_SCENE__.size;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    return clamp((s.height / Math.max(1, s.width)) * (8.6 / 11.2) * 0.92, 1, 1.5);
  });
  const rz = zs * 1.08;

  // 1 — approve the pending permission by pressing the ✓ cap in the scene.
  await page.waitForFunction(
    () => Object.keys(globalThis.__OPENDECK_STORE__.getState().permissions).length > 0,
    null,
    { timeout: 60_000 },
  );
  const before = await store();
  const pendingId = Object.keys(before.permissions)[0];
  const [ax, ay] = await screenPos(page, -0.96, 0.12, 1.7 * rz);
  await page.touchscreen.tap(ax, ay);
  await page.waitForTimeout(600);
  const afterApprove = await store();
  if (pendingId in afterApprove.permissions) {
    out(`tap point: ${ax.toFixed(0)},${ay.toFixed(0)}`);
    await page.screenshot({ path: join(root, 'e2e', 'usetest-fail.png') });
    fail('approve key press did not resolve the permission');
  }
  out('PASS approve via 3d ✓ key');

  // 2 — swipe the plate to page through agents (7 sessions = 2 pages).
  const agentButtons = () =>
    page.evaluate(
      () =>
        Array.from(document.querySelectorAll('.sr-only button')).filter((b) =>
          (b.textContent ?? '').includes('—'),
        ).length,
    );
  const page1Count = await agentButtons();
  // Start in the empty band between rows so no control claims the touch.
  await page.mouse.move(271, 465);
  await page.mouse.down();
  await page.mouse.move(91, 470, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const page2Count = await agentButtons();
  if (page1Count !== 6 || page2Count !== 1) {
    await page.screenshot({ path: join(root, 'e2e', 'usetest-fail.png') });
    fail(`swipe paging failed: page1=${page1Count} page2=${page2Count}`);
  }
  await page.mouse.move(91, 465);
  await page.mouse.down();
  await page.mouse.move(281, 470, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  if ((await agentButtons()) !== 6) fail('swipe back to page 1 failed');
  out('PASS page swiping');

  // 3 — knob: drag vertically two detents and read the footer value.
  const [kx, ky] = await screenPos(page, -2.9, 0.3, -2 * rz);
  await page.mouse.move(kx, ky);
  await page.mouse.down();
  await page.mouse.move(kx, ky - 56, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const footer = await page.evaluate(
    () => document.querySelector('.font-data.uppercase')?.textContent ?? '',
  );
  if (!footer.includes('opus')) fail(`knob drag did not reach opus (footer: ${footer})`);
  out('PASS knob vertical drag to opus');

  await browser.close();
  out('usetest done');
} finally {
  hub.kill('SIGTERM');
  rmSync(home, { recursive: true, force: true });
}
