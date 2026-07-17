import { expect, test } from '@playwright/test';
import { deckState, hubs } from '../helpers.js';

/**
 * Simulator-driven deck behavior on the open hub. Runs on every viewport
 * project; anything that consumes one-shot demo state lives in its own spec
 * pinned to a single project.
 */

test.beforeEach(async ({ page }) => {
  await page.goto(hubs().openUrl);
});

test('tiles track the scripted fleet statuses', async ({ page }) => {
  // The whole mixed fleet lands on the grid.
  await expect(page.getByRole('button', { name: /fix flaky auth test/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /migrate to app router/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /terraform drift check/ })).toBeVisible();

  // Scripted transitions show up as live tile statuses.
  await expect(page.getByRole('button', { name: /fix flaky auth test/ })).toContainText(
    'needs approval',
  );
  await expect(page.getByRole('button', { name: /tune retrieval evals/ })).toContainText('error');
  await expect(page.getByRole('button', { name: /migrate to app router/ })).toContainText(
    /working|thinking|Bash|Edit/,
  );

  // The stat bar reports honest connection state and fleet counts.
  await expect(page.getByRole('status', { name: /Connection:/ })).toHaveAttribute(
    'aria-label',
    'Connection: connected',
  );
  await expect(page.getByText(/\d+ running · \d+ waiting/)).toBeVisible();
});

test('theme switch repaints the slab from token JSON', async ({ page }) => {
  const slab = async (): Promise<string> =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--surface-0'));

  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'workshop' }).click();
  expect(await slab()).toBe('#EDE6D6');

  await page.getByRole('button', { name: 'graphite' }).click();
  expect(await slab()).toBe('#0E0F12');
  await page.getByRole('button', { name: 'Back to the grid' }).click();
  await expect(page.getByRole('button', { name: /fix flaky auth test/ })).toBeVisible();
});

test('voice key advertises hold-to-talk on secure contexts', async ({ page }) => {
  // 127.0.0.1 is a secure context and chromium ships webkitSpeechRecognition,
  // so the key must be armed, not the explanatory fallback.
  await expect(page.getByRole('button', { name: 'Hold to talk' }).first()).toBeVisible();
});

test('reduced motion removes the Deskglow and pulses', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(hubs().openUrl);
  await expect(page.getByRole('button', { name: /fix flaky auth test/ })).toBeVisible();

  const glowDisplay = await page.evaluate(() => {
    const glow = document.querySelector('.deskglow-edges');
    return glow === null ? 'missing' : getComputedStyle(glow).display;
  });
  expect(glowDisplay === 'none' || glowDisplay === 'missing').toBe(true);

  const pulseAnimation = await page.evaluate(() => {
    const pulsing = document.querySelector('.pulse-waiting');
    return pulsing === null ? 'none' : getComputedStyle(pulsing).animationName;
  });
  expect(pulseAnimation).toBe('none');

  await page.screenshot({ path: 'test-results/reduced-motion.png', fullPage: true });
  await context.close();
});

test('the deck folds live events exactly like the hub', async ({ page }) => {
  await expect(page.getByRole('button', { name: /fix flaky auth test/ })).toBeVisible();
  await expect
    .poll(async () => {
      const state = await deckState(page);
      return Object.keys(state.sessions).length;
    })
    .toBeGreaterThanOrEqual(6);
  const state = await deckState(page);
  expect(state.connection).toBe('connected');
  expect(state.lastSeq).toBeGreaterThan(0);
});
