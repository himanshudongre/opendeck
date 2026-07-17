#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import qrcode from 'qrcode-terminal';
import { connectClaude, disconnectClaude, type ConnectScope } from './adapters/claude/connect.js';
import { startDemoFleet } from './adapters/simulator.js';
import { loadConfig } from './config.js';
import { logger, term } from './logger.js';
import { DeviceStore } from './server/auth.js';
import { startHub, type RunningHub } from './server/start.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

interface RunFlags {
  demo?: boolean;
  port?: string;
  localhostOnly?: boolean;
  auth?: boolean;
}

/** True when whatever answers on this port is one of ours. */
async function isOurHub(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { hubId?: unknown };
    return typeof body.hubId === 'string' && body.hubId.startsWith('hub-');
  } catch {
    return false;
  }
}

/** Asks the hub on this port to shut down; true once the port is free. */
async function stopHubOnPort(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${String(port)}/api/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!(await isOurHub(port))) return true;
  }
  return false;
}

async function run(flags: RunFlags): Promise<void> {
  const configResult = loadConfig();
  for (const problem of configResult.ok ? [] : configResult.problems) {
    term.error(`config: ${problem}`);
  }
  const noAuth = flags.auth === false;
  if (noAuth) {
    term.line('⚠ Running with --no-auth: anyone on this network can control your agents.');
  }

  // Tokens are one-time (SPEC §8): after each pairing, print a fresh QR so
  // the next device (the iPad after the phone) scans without a restart.
  let reissue: (() => void) | undefined;
  let running: RunningHub;
  let requestShutdown: () => void = () => undefined;
  const requestedPort =
    flags.port === undefined ? configResult.config.port : Number.parseInt(flags.port, 10);

  const boot = (): Promise<RunningHub> =>
    startHub({
      config: configResult.config,
      version: pkg.version,
      ...(flags.port === undefined ? {} : { port: Number.parseInt(flags.port, 10) }),
      ...(flags.localhostOnly === undefined ? {} : { localhostOnly: flags.localhostOnly }),
      noAuth,
      onPaired: (name) => {
        term.line(`📱 ${name} paired`);
        reissue?.();
      },
      onShutdownRequest: () => {
        requestShutdown();
      },
    });

  try {
    running = await boot();
  } catch (error) {
    const portBusy = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
    // Starting is idempotent: an old hub on our port hands it over.
    if (portBusy && (await isOurHub(requestedPort))) {
      term.line(`Another hub is on port ${requestedPort} — taking over.`);
      if (await stopHubOnPort(requestedPort)) {
        try {
          running = await boot();
        } catch (retryError) {
          term.error(retryError instanceof Error ? retryError.message : 'The hub failed to start.');
          process.exitCode = 1;
          return;
        }
      } else {
        term.error(`The hub on port ${requestedPort} did not hand over. Try \`opendeck stop\`.`);
        process.exitCode = 1;
        return;
      }
    } else if (portBusy) {
      term.error(
        `Port ${requestedPort} is in use by something that isn't an OpenDeck hub. Stop it, or start with --port <n>.`,
      );
      process.exitCode = 1;
      return;
    } else {
      term.error(error instanceof Error ? error.message : 'The hub failed to start.');
      process.exitCode = 1;
      return;
    }
  }

  const demo = flags.demo ?? false;
  const fleet = demo
    ? startDemoFleet(running.hub, {
        ...(process.env.OPENDECK_SIM_SPEED === undefined
          ? {}
          : { speed: Number.parseFloat(process.env.OPENDECK_SIM_SPEED) }),
        ...(process.env.OPENDECK_SIM_SEED === undefined
          ? {}
          : { seed: Number.parseInt(process.env.OPENDECK_SIM_SEED, 10) }),
      })
    : undefined;

  const detections = await running.detectAdapters();
  printBanner(running, {
    noAuth,
    demo,
    harnessNotes: detections.flatMap((d) => (d.note === undefined ? [] : [d.note])),
  });
  if (!noAuth) {
    reissue = () => {
      printPairingQr(running, 'Next device: scan this fresh code.');
    };
    // Tokens expire after ten minutes; keep a scannable code on screen.
    const refresh = setInterval(
      () => {
        printPairingQr(running, 'The previous code expired. This one is fresh.');
      },
      9 * 60 * 1000,
    );
    refresh.unref();
  }

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    term.line('');
    term.line('Stopping hub…');
    fleet?.stop();
    void running.close().then(() => process.exit(0));
  };
  requestShutdown = shutdown;
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function printBanner(
  running: RunningHub,
  opts: { noAuth: boolean; demo: boolean; harnessNotes: string[] },
): void {
  const primaryUrl = running.lanUrls[0] ?? `http://localhost:${running.port}`;
  term.line('');
  term.line(`  ▲ OpenDeck hub v${pkg.version}${opts.demo ? ' · demo fleet' : ''}`);
  if (opts.harnessNotes.length > 0) {
    term.line(`  ${opts.harnessNotes.map((note) => `● ${note}`).join(' · ')}`);
  }
  term.line('');
  if (running.host === '127.0.0.1') {
    term.line(`  Deck ready →  http://localhost:${running.port}   (localhost only)`);
  } else {
    term.line(`  Deck ready →  ${running.mdnsUrl}   (or ${primaryUrl})`);
  }
  if (running.httpsPort !== undefined) {
    term.line(`  Voice lane →  https://…:${running.httpsPort}   (enable in deck Settings)`);
  }
  term.line('');

  if (opts.noAuth) {
    term.line(`  Open ${primaryUrl} on your phone — no pairing needed (--no-auth).`);
    term.line('');
    return;
  }

  printPairingQr(running, 'Scan with your phone to pair. The code is valid for 10 minutes;');
  logger().info({ port: running.port, host: running.host }, 'hub started');
}

function printPairingQr(running: RunningHub, lead: string): void {
  const primaryUrl = running.lanUrls[0] ?? `http://localhost:${running.port}`;
  const token = running.pairing.issueToken();
  const pairUrl = `${primaryUrl}/#pair=${token}`;
  qrcode.generate(pairUrl, { small: true }, (qr) => {
    for (const line of qr.split('\n')) term.line(`  ${line}`);
  });
  term.line(`  ${lead}`);
  term.line(`  or open ${pairUrl}`);
  term.line('');
}

function devicesList(): void {
  const store = new DeviceStore();
  const devices = store.list();
  if (devices.length === 0) {
    term.line('No paired devices. Run `opendeck` and scan the QR code to pair one.');
    return;
  }
  for (const device of devices) {
    const seen = new Date(device.lastSeenAt).toISOString();
    term.line(`${device.id}  ${device.name}  last seen ${seen}`);
  }
}

function devicesRevoke(id: string): void {
  const store = new DeviceStore();
  if (store.revoke(id)) {
    term.line(`Revoked ${id}. That device can no longer reach this hub.`);
  } else {
    term.error(`No device with id ${id}. Run \`opendeck devices list\` to see ids.`);
    process.exitCode = 1;
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('opendeck')
    .description('A physical-feeling command deck for AI coding agents, made of software.')
    .version(pkg.version)
    .option('--demo', 'start with a simulated fleet — no agents or keys needed')
    .option('--port <port>', 'HTTP port for the deck (default 3325)')
    .option('--localhost-only', 'bind to 127.0.0.1 instead of the LAN')
    .option('--no-auth', 'skip device pairing (loud warning; trusted networks only)')
    .action((flags: RunFlags) => run(flags));

  program
    .command('stop')
    .description('stop the running hub')
    .option('--port <port>', 'hub port (default from config)')
    .action(async (opts: { port?: string }) => {
      const config = loadConfig();
      const port = opts.port === undefined ? config.config.port : Number.parseInt(opts.port, 10);
      if (!(await isOurHub(port))) {
        term.line(`No hub is running on port ${port}.`);
        return;
      }
      if (await stopHubOnPort(port)) {
        term.line(`Hub on port ${port} stopped.`);
      } else {
        term.error(`The hub on port ${port} did not stop. Find it with \`lsof -i :${port}\`.`);
        process.exitCode = 1;
      }
    });

  program
    .command('status')
    .description('show whether a hub is running and what it sees')
    .option('--port <port>', 'hub port (default from config)')
    .action(async (opts: { port?: string }) => {
      const config = loadConfig();
      const port = opts.port === undefined ? config.config.port : Number.parseInt(opts.port, 10);
      try {
        const health = await fetch(`http://127.0.0.1:${String(port)}/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!health.ok) throw new Error('unhealthy');
        const body = (await health.json()) as { version: string; hubId: string };
        term.line(`Hub v${body.version} running on port ${port}.`);
      } catch {
        term.line(`No hub is running on port ${port}. Start one with \`opendeck\`.`);
        return;
      }
      const devices = new DeviceStore().list();
      term.line(
        devices.length === 0
          ? 'No devices paired yet — scan the QR in the hub terminal.'
          : `${devices.length} paired device${devices.length === 1 ? '' : 's'}.`,
      );
    });

  program
    .command('connect')
    .argument('<harness>', 'harness to observe (claude)')
    .option('--project', 'write hooks to this project’s .claude/settings.json instead of ~/.claude')
    .description('report your own terminal sessions to the deck via hooks')
    .action((harness: string, opts: { project?: boolean }) => {
      if (harness !== 'claude') {
        term.error(`Observed mode supports claude for now, not ${harness}.`);
        process.exitCode = 1;
        return;
      }
      const scope: ConnectScope = opts.project === true ? 'project' : 'user';
      const config = loadConfig();
      const result = connectClaude({ scope, port: config.config.port });
      term.line(
        result.changed
          ? `Hooks written to ${result.path}. Claude Code sessions now show on the deck while the hub runs.`
          : `Hooks already present in ${result.path}. Nothing to do.`,
      );
    });

  program
    .command('disconnect')
    .argument('<harness>', 'harness to stop observing (claude)')
    .option('--project', 'remove hooks from this project’s .claude/settings.json')
    .description('remove the hooks written by connect')
    .action((harness: string, opts: { project?: boolean }) => {
      if (harness !== 'claude') {
        term.error(`Observed mode supports claude for now, not ${harness}.`);
        process.exitCode = 1;
        return;
      }
      const scope: ConnectScope = opts.project === true ? 'project' : 'user';
      const config = loadConfig();
      const result = disconnectClaude({ scope, port: config.config.port });
      term.line(
        result.changed
          ? `Removed OpenDeck hooks from ${result.path}.`
          : `No OpenDeck hooks found in ${result.path}.`,
      );
    });

  const devices = program.command('devices').description('manage paired deck devices');
  devices.command('list').description('list paired devices').action(devicesList);
  devices.command('revoke <id>').description('revoke a paired device').action(devicesRevoke);

  return program;
}

await buildProgram().parseAsync(process.argv);
