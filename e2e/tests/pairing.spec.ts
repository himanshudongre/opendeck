import { expect, test } from '@playwright/test';
import { hubs } from '../helpers.js';

/**
 * Pairing via the tokened QR URL (SPEC §5). The token is one-time, so this
 * runs on a single project against the authenticated hub.
 */
test.describe('pairing', () => {
  test('the QR url pairs, connects, and survives a reload', async ({ page }) => {
    const { authUrl, pairToken } = hubs();

    await page.goto(`${authUrl}/#pair=${pairToken}`);

    // Token exchanged for a device credential; live tiles arrive.
    await expect(page.getByRole('status', { name: /Connection:/ })).toHaveAttribute(
      'aria-label',
      'Connection: connected',
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByRole('button', { name: /fix flaky auth test/ })).toBeVisible();

    // The one-time token is scrubbed from the URL and a credential persisted.
    expect(page.url()).not.toContain('pair=');
    const stored = await page.evaluate(() => localStorage.getItem('agentdeck.pairing'));
    expect(stored).toContain('deviceId');

    // Subsequent visits auto-connect with the stored credential.
    await page.reload();
    await expect(page.getByRole('status', { name: /Connection:/ })).toHaveAttribute(
      'aria-label',
      'Connection: connected',
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByRole('button', { name: /migrate to app router/ })).toBeVisible();
  });

  test('a stale token lands on the pair screen with the reason', async ({ page }) => {
    const { authUrl, pairToken } = hubs();
    // The first test consumed the token; replaying it must fail loudly.
    await page.goto(`${authUrl}/#pair=${pairToken}`);
    await expect(page.getByText(/isn’t paired yet/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/invalid or expired/)).toBeVisible();
  });
});
