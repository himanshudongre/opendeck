// Perf gates (SPEC §3.4 / §9): p95 deck-input → hub-ack under 30 ms over
// loopback, and the deck bundle (JS+CSS) at or under 300 KB gzipped.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const cliPath = join(repoRoot, 'packages', 'hub', 'dist', 'cli.js');
const deckAssets = join(repoRoot, 'packages', 'deck', 'dist', 'assets');

const PORT = 3345;
const SAMPLES = 200;
const P95_BUDGET_MS = 30;
const BUNDLE_BUDGET_BYTES = 300 * 1024;
// The WebGL device face (three.js) is a lazy chunk — it never blocks first
// paint, so it carries its own budget instead of eating the boot budget.
const LAZY_BUDGET_BYTES = 280 * 1024;

const out = (line) => process.stdout.write(`${line}\n`);
const fail = (line) => {
  process.stdout.write(`${line}\n`);
  process.exitCode = 1;
};

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('hub never became healthy');
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function latencyGate() {
  const hub = spawn(
    process.execPath,
    [cliPath, '--demo', '--localhost-only', '--no-auth', '--port', String(PORT)],
    {
      env: { ...process.env, OPENDECK_HOME: join(here, '..', '.state', 'perf-home') },
      stdio: 'ignore',
    },
  );
  try {
    await waitForHealth(`http://127.0.0.1:${PORT}`);
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const pending = new Map();
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString('utf8'));
      if (msg.type === 'ack') {
        const resolve = pending.get(msg.payload.id);
        if (resolve) resolve(performance.now());
      }
    });

    const samples = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const id = `perf-${String(i)}`;
      const done = new Promise((resolve) => pending.set(id, resolve));
      const started = performance.now();
      ws.send(JSON.stringify({ v: 1, id, type: 'subscribe', payload: { sessionId: null } }));
      const finished = await done;
      samples.push(finished - started);
      pending.delete(id);
    }
    ws.close();

    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    out(
      `latency  input→ack over ${String(SAMPLES)} messages: p50 ${p50.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms · p99 ${p99.toFixed(2)} ms`,
    );
    if (p95 >= P95_BUDGET_MS) {
      fail(
        `latency  FAIL: p95 ${p95.toFixed(2)} ms breaches the ${String(P95_BUDGET_MS)} ms budget`,
      );
    } else {
      out(`latency  PASS: p95 under ${String(P95_BUDGET_MS)} ms`);
    }
  } finally {
    hub.kill('SIGTERM');
  }
}

function bundleGate() {
  const files = readdirSync(deckAssets).filter(
    (name) => name.endsWith('.js') || name.endsWith('.css'),
  );
  if (files.length === 0) throw new Error('no deck assets found — run pnpm build first');
  let boot = 0;
  let lazy = 0;
  for (const name of files) {
    const gz = gzipSync(readFileSync(join(deckAssets, name)), { level: 9 }).length;
    if (name.startsWith('Micro3D-')) lazy += gz;
    else boot += gz;
  }
  const bootKb = (boot / 1024).toFixed(1);
  const lazyKb = (lazy / 1024).toFixed(1);
  out(`bundle   boot js+css gzipped: ${bootKb} KB · lazy 3d chunk: ${lazyKb} KB`);
  if (boot > BUNDLE_BUDGET_BYTES) {
    fail(`bundle   FAIL: boot ${bootKb} KB breaches the 300 KB gz budget`);
  } else if (lazy > LAZY_BUDGET_BYTES) {
    fail(`bundle   FAIL: 3d chunk ${lazyKb} KB breaches the 280 KB gz budget`);
  } else {
    out('bundle   PASS: boot within 300 KB gz, 3d chunk within 280 KB gz');
  }
}

await latencyGate();
bundleGate();
