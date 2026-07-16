import type { Scenario, ScriptedSession, SimContext } from './runner.js';

const AUTH_RETRY_DIFF = `--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -41,9 +41,13 @@ export async function refreshSession(token: string) {
-  const res = await fetchWithTimeout('/oauth/refresh', { token }, 3_000);
-  if (!res.ok) {
-    throw new AuthError('refresh failed');
+  for (let attempt = 1; attempt <= 3; attempt += 1) {
+    const res = await fetchWithTimeout('/oauth/refresh', { token }, 3_000 * attempt);
+    if (res.ok) return res.session;
+    if (res.status !== 503 || attempt === 3) {
+      throw new AuthError(\`refresh failed after \${attempt} attempts\`);
+    }
+    await backoff(attempt);
   }
-  return res.session;
 }`;

const MIGRATION_DIFF = `--- a/db/migrations/0042_invoice_index.sql
+++ b/db/migrations/0042_invoice_index.sql
@@ -1,3 +1,4 @@
+CREATE INDEX CONCURRENTLY idx_invoices_customer_created
+  ON invoices (customer_id, created_at DESC);
-CREATE INDEX idx_invoices_customer ON invoices (customer_id);`;

/** Claude session that hits a permission gate with a diff — the hero flow. */
const fixFlakyAuth: Scenario = async (ctx) => {
  await ctx.sleep(1800);
  ctx.status('thinking');
  ctx.transcript('assistant', 'Reading the failing test to find the flake…');
  ctx.addStats({ input: 2400, output: 180, turns: 1, cost: 0.011 });
  await ctx.sleep(2600);

  ctx.status('working', { name: 'Bash', detail: 'pnpm vitest run auth' });
  ctx.tool('start', 'Bash', 'pnpm vitest run auth');
  await ctx.sleep(3400);
  ctx.tool('end', 'Bash', 'pnpm vitest run auth', true);
  ctx.transcript(
    'assistant',
    'The refresh call races a 503 from the token service. Adding retry with backoff.',
  );
  ctx.addStats({ input: 3100, output: 420, turns: 1, cost: 0.018 });
  await ctx.sleep(1600);

  const resolution = await ctx.permission({
    name: 'Edit',
    input: 'src/auth/session.ts',
    diff: AUTH_RETRY_DIFF,
  });
  if (resolution === 'deny') {
    ctx.transcript('assistant', 'Understood — leaving session.ts untouched. Stopping here.');
    ctx.status('idle');
    return;
  }

  ctx.status('working', { name: 'Edit', detail: 'src/auth/session.ts' });
  ctx.tool('start', 'Edit', 'src/auth/session.ts');
  await ctx.sleep(1400);
  ctx.tool('end', 'Edit', 'src/auth/session.ts', true);

  ctx.status('working', { name: 'Bash', detail: 'pnpm vitest run auth' });
  ctx.tool('start', 'Bash', 'pnpm vitest run auth');
  await ctx.sleep(3800);
  ctx.tool('end', 'Bash', 'pnpm vitest run auth', true);
  ctx.transcript('assistant', 'auth suite: 34 passed, 0 flaked across 50 repeats. Done.');
  ctx.addStats({ input: 5200, output: 610, turns: 2, cost: 0.031 });
  ctx.status('done');
};

/** Codex long-runner that never finishes during a demo. */
const appRouterMigration: Scenario = async (ctx) => {
  await ctx.sleep(900);
  ctx.status('thinking');
  ctx.transcript('assistant', 'Mapping pages/ routes to the app router layout…');
  ctx.addStats({ input: 5400, output: 300, turns: 1 });
  await ctx.sleep(2400);

  const files = [
    'app/(shop)/products/page.tsx',
    'app/(shop)/cart/page.tsx',
    'app/checkout/layout.tsx',
    'app/api/webhooks/stripe/route.ts',
    'app/(account)/orders/page.tsx',
    'app/(account)/settings/page.tsx',
  ];
  for (let round = 0; ; round += 1) {
    const file = files[round % files.length] ?? files[0] ?? '';
    ctx.status('working', { name: 'Edit', detail: file });
    ctx.tool('start', 'Edit', file);
    await ctx.sleep(2800);
    ctx.tool('end', 'Edit', file, true);
    ctx.addStats({ input: 1900, output: 260, turns: 1 });

    if (round % 3 === 2) {
      ctx.status('working', { name: 'Bash', detail: 'pnpm next build' });
      ctx.tool('start', 'Bash', 'pnpm next build');
      await ctx.sleep(5200);
      ctx.tool('end', 'Bash', 'pnpm next build', true);
      ctx.notice('info', `Build green after ${String(round + 1)} routes migrated`);
    }
  }
};

/** Observed terminal session: quick loops of thinking → working → done. */
const terraformDrift: Scenario = async (ctx) => {
  for (;;) {
    await ctx.sleep(2200);
    ctx.status('thinking');
    await ctx.sleep(1500);
    ctx.status('working', { name: 'Bash', detail: 'terraform plan -detailed-exitcode' });
    ctx.tool('start', 'Bash', 'terraform plan -detailed-exitcode');
    await ctx.sleep(4200);
    ctx.tool('end', 'Bash', 'terraform plan -detailed-exitcode', true);
    ctx.addStats({ input: 2100, output: 150, turns: 1, cost: 0.008 });
    ctx.status('done');
    await ctx.sleep(6000);
    ctx.status('idle');
    await ctx.sleep(8000);
  }
};

/** Error scenario: a run that fails loudly. */
const retrievalEvals: Scenario = async (ctx) => {
  await ctx.sleep(1200);
  ctx.status('working', { name: 'Bash', detail: 'python evals/run.py --suite retrieval' });
  ctx.tool('start', 'Bash', 'python evals/run.py --suite retrieval');
  ctx.addStats({ input: 900, output: 60, turns: 1 });
  await ctx.sleep(5200);
  ctx.tool('end', 'Bash', 'python evals/run.py --suite retrieval', false);
  ctx.transcript(
    'assistant',
    'Eval run failed: the embeddings service returned 401. The EMBED_API_KEY in .env.eval expired.',
  );
  ctx.notice('error', 'evals/run.py exited 1 — expired EMBED_API_KEY');
  ctx.status('error');
};

/** Quick, tidy win — done and green early so the grid shows variety. */
const quickstartRewrite: Scenario = async (ctx) => {
  await ctx.sleep(700);
  ctx.status('working', { name: 'Edit', detail: 'docs/quickstart.md' });
  ctx.tool('start', 'Edit', 'docs/quickstart.md');
  await ctx.sleep(2600);
  ctx.tool('end', 'Edit', 'docs/quickstart.md', true);
  ctx.addStats({ input: 1400, output: 520, turns: 1, cost: 0.009 });
  ctx.transcript(
    'assistant',
    'Quickstart now gets to a running app in five steps instead of nine.',
  );
  ctx.status('done');
};

/** Session that stops to ask — the waiting_input amber state. */
const profileRedesign: Scenario = async (ctx) => {
  await ctx.sleep(1400);
  ctx.status('thinking');
  await ctx.sleep(2000);
  ctx.status('working', { name: 'Read', detail: 'src/components/ProfileCard.tsx' });
  ctx.tool('start', 'Read', 'src/components/ProfileCard.tsx');
  await ctx.sleep(1900);
  ctx.tool('end', 'Read', 'src/components/ProfileCard.tsx', true);
  ctx.addStats({ input: 1700, output: 210, turns: 1, cost: 0.007 });
  ctx.transcript(
    'assistant',
    'Two candidates for the avatar block: keep the 96px circle, or switch to the squircle used on the team page. Which direction?',
  );
  ctx.status('waiting_input');
};

/** Second permission scenario: a database migration approval. */
const invoiceIndex: Scenario = async (ctx) => {
  await ctx.sleep(4200);
  ctx.status('thinking');
  ctx.transcript('assistant', 'The invoices list scans 2.1M rows per page load. Adding an index.');
  ctx.addStats({ input: 2900, output: 240, turns: 1 });
  await ctx.sleep(3000);

  const resolution = await ctx.permission({
    name: 'Bash',
    input: 'psql -f db/migrations/0042_invoice_index.sql',
    diff: MIGRATION_DIFF,
  });
  if (resolution === 'deny') {
    ctx.transcript('assistant', 'Skipping the migration. The query plan stays as is.');
    ctx.status('idle');
    return;
  }
  ctx.status('working', { name: 'Bash', detail: 'psql -f db/migrations/0042…' });
  ctx.tool('start', 'Bash', 'psql -f db/migrations/0042_invoice_index.sql');
  await ctx.sleep(4400);
  ctx.tool('end', 'Bash', 'psql -f db/migrations/0042_invoice_index.sql', true);
  ctx.addStats({ input: 800, output: 90, turns: 1 });
  ctx.transcript('assistant', 'Index built. Invoice list p95 went from 1.9 s to 140 ms locally.');
  ctx.status('done');
};

export function demoFleet(): ScriptedSession[] {
  return [
    {
      session: {
        id: 'sim-auth',
        harness: 'claude',
        mode: 'managed',
        title: 'fix flaky auth test',
        cwd: '/home/dev/acme/api',
        repo: 'acme/api',
        branch: 'fix/flaky-auth-refresh',
        model: 'claude-sonnet-5',
        capabilities: [
          'prompt',
          'interrupt',
          'approve',
          'set_effort',
          'set_model',
          'kill',
          'transcript',
        ],
      },
      scenario: fixFlakyAuth,
    },
    {
      session: {
        id: 'sim-router',
        harness: 'codex',
        mode: 'managed',
        title: 'migrate to app router',
        cwd: '/home/dev/acme/storefront',
        repo: 'acme/storefront',
        branch: 'feat/app-router',
        model: 'gpt-5.2-codex',
        capabilities: ['prompt', 'interrupt', 'set_effort', 'kill', 'transcript'],
      },
      scenario: appRouterMigration,
    },
    {
      session: {
        id: 'sim-drift',
        harness: 'claude',
        mode: 'observed',
        title: 'terraform drift check',
        cwd: '/home/dev/acme/infra',
        repo: 'acme/infra',
        branch: 'main',
        capabilities: ['transcript'],
      },
      scenario: terraformDrift,
    },
    {
      session: {
        id: 'sim-evals',
        harness: 'codex',
        mode: 'managed',
        title: 'tune retrieval evals',
        cwd: '/home/dev/acme/ml',
        repo: 'acme/ml',
        branch: 'exp/retrieval-rerank',
        model: 'gpt-5.2-codex',
        capabilities: ['prompt', 'interrupt', 'set_effort', 'kill', 'transcript'],
      },
      scenario: retrievalEvals,
    },
    {
      session: {
        id: 'sim-docs',
        harness: 'simulator',
        mode: 'managed',
        title: 'rewrite quickstart guide',
        cwd: '/home/dev/acme/docs',
        repo: 'acme/docs',
        branch: 'docs/quickstart-v2',
        capabilities: ['prompt', 'transcript'],
      },
      scenario: quickstartRewrite,
    },
    {
      session: {
        id: 'sim-profile',
        harness: 'claude',
        mode: 'managed',
        title: 'profile page redesign',
        cwd: '/home/dev/acme/app',
        repo: 'acme/app',
        branch: 'feat/profile-refresh',
        model: 'claude-opus-4-8',
        capabilities: [
          'prompt',
          'interrupt',
          'approve',
          'set_effort',
          'set_model',
          'kill',
          'transcript',
        ],
      },
      scenario: profileRedesign,
    },
    {
      session: {
        id: 'sim-invoice',
        harness: 'claude',
        mode: 'managed',
        title: 'speed up invoice list',
        cwd: '/home/dev/acme/api',
        repo: 'acme/api',
        branch: 'perf/invoice-index',
        model: 'claude-sonnet-5',
        capabilities: ['prompt', 'interrupt', 'approve', 'set_effort', 'kill', 'transcript'],
      },
      scenario: invoiceIndex,
    },
  ];
}

export type { SimContext };
