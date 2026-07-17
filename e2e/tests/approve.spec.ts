import { expect, test } from '@playwright/test';
import { hubs, openDeck } from '../helpers.js';

/**
 * The approve round-trip consumes the invoice session's one-shot permission,
 * so it runs on a single project against the shared demo hub.
 */
test.describe('approve round-trip', () => {
  test('a deck tap resolves the permission and the scenario continues', async ({ page }) => {
    await openDeck(page, hubs().openUrl);

    const invoiceTile = page.getByRole('button', { name: /speed up invoice list/ });
    await expect(invoiceTile).toContainText('needs approval');
    await invoiceTile.click();

    // The card shows the actual migration diff, not a blind prompt.
    await expect(page.getByText('Bash wants to run')).toBeVisible();
    await expect(page.getByText(/CREATE INDEX CONCURRENTLY/)).toBeVisible();

    await page.getByRole('button', { name: 'Approve Bash' }).click();
    await expect(page.getByText('Bash wants to run')).toHaveCount(0);

    // Approval unblocks the script: the session runs the migration and lands done.
    await expect(page.getByText(/done|Index built/).first()).toBeVisible({ timeout: 20_000 });
  });
});
