import { expect, test } from '@playwright/test';
import { deckState, hubSnapshot, hubs } from '../helpers.js';

/**
 * THE reconnect test (SPEC §9): kill the network mid-scenario, let the fleet
 * keep emitting, and assert the deck resumes via replay — `resumed`, never a
 * `snapshot` fallback — with the sequence caught up past everything missed.
 */
test.describe('reconnect', () => {
  test('a dropped socket resumes with zero missed events', async ({ page, context }) => {
    const { openUrl } = hubs();
    await page.goto(openUrl);
    await expect(page.getByRole('status', { name: /Connection:/ })).toHaveAttribute(
      'aria-label',
      'Connection: connected',
    );
    await expect
      .poll(async () => Object.keys((await deckState(page)).sessions).length)
      .toBeGreaterThanOrEqual(6);

    const before = await deckState(page);

    // The network dies mid-scenario…
    await context.setOffline(true);
    await expect(page.getByText('Reconnecting to the hub…')).toBeVisible({ timeout: 20_000 });

    // …while the long-runner keeps the hub emitting well past the deck's seq.
    let seqWhileOffline = before.lastSeq;
    await expect
      .poll(
        async () => {
          const snapshot = await hubSnapshot(openUrl);
          seqWhileOffline = snapshot.seq;
          return snapshot.seq;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(before.lastSeq + 5);

    await context.setOffline(false);
    await expect(page.getByRole('status', { name: /Connection:/ })).toHaveAttribute(
      'aria-label',
      'Connection: connected',
      {
        timeout: 20_000,
      },
    );

    // Zero missed events: the gap fit the replay buffer and was replayed.
    await expect
      .poll(async () => (await deckState(page)).lastSeq)
      .toBeGreaterThanOrEqual(seqWhileOffline);
    const after = await deckState(page);
    expect(after.lastResume).toBe('resumed');

    // And the deck's fleet matches the hub's, session for session.
    const finalSnapshot = await hubSnapshot(openUrl);
    for (const session of finalSnapshot.sessions) {
      expect(after.sessions[session.id]).toBeDefined();
    }
  });
});
