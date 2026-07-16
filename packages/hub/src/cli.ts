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

async function run(flags: RunFlags): Promise<void> {
  const configResult = loadConfig();
  for (const problem of configResult.ok ? [] : configResult.problems) {
    term.error(`config: ${problem}`);
  }
  const noAuth = flags.auth === false;
  if (noAuth) {
    term.line('⚠ Running with --no-auth: anyone on this network can control your agents.');
  }

  const running = await startHub({
    config: configResult.config,
    version: pkg.version,
    ...(flags.port === undefined ? {} : { port: Number.parseInt(flags.port, 10) }),
    ...(flags.localhostOnly === undefined ? {} : { localhostOnly: flags.localhostOnly }),
    noAuth,
    onPaired: (name) => {
      term.line(`📱 ${name} paired`);
    },
  });

  const demo = flags.demo ?? false;
  const fleet = demo
    ? startDemoFleet(running.hub, {
        ...(process.env.AGENTDECK_SIM_SPEED === undefined
          ? {}
          : { speed: Number.parseFloat(process.env.AGENTDECK_SIM_SPEED) }),
        ...(process.env.AGENTDECK_SIM_SEED === undefined
          ? {}
          : { seed: Number.parseInt(process.env.AGENTDECK_SIM_SEED, 10) }),
      })
    : undefined;

  const detections = await running.detectAdapters();
  printBanner(running, {
    noAuth,
    demo,
    harnessNotes: detections.flatMap((d) => (d.note === undefined ? [] : [d.note])),
  });

  const shutdown = (): void => {
    term.line('');
    term.line('Stopping hub…');
    fleet?.stop();
    void running.close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function printBanner(
  running: RunningHub,
  opts: { noAuth: boolean; demo: boolean; harnessNotes: string[] },
): void {
  const primaryUrl = running.lanUrls[0] ?? `http://localhost:${running.port}`;
  term.line('');
  term.line(`  ▲ AgentDeck hub v${pkg.version}${opts.demo ? ' · demo fleet' : ''}`);
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

  const token = running.pairing.issueToken();
  const pairUrl = `${primaryUrl}/#pair=${token}`;
  qrcode.generate(pairUrl, { small: true }, (qr) => {
    for (const line of qr.split('\n')) term.line(`  ${line}`);
  });
  term.line('  Scan with your phone to pair. The code is valid for 10 minutes;');
  term.line(`  or open ${pairUrl}`);
  term.line('');
  logger().info({ port: running.port, host: running.host }, 'hub started');
}

function devicesList(): void {
  const store = new DeviceStore();
  const devices = store.list();
  if (devices.length === 0) {
    term.line('No paired devices. Run `agentdeck` and scan the QR code to pair one.');
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
    term.error(`No device with id ${id}. Run \`agentdeck devices list\` to see ids.`);
    process.exitCode = 1;
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('agentdeck')
    .description('A physical-feeling command deck for AI coding agents, made of software.')
    .version(pkg.version)
    .option('--demo', 'start with a simulated fleet — no agents or keys needed')
    .option('--port <port>', 'HTTP port for the deck (default 3325)')
    .option('--localhost-only', 'bind to 127.0.0.1 instead of the LAN')
    .option('--no-auth', 'skip device pairing (loud warning; trusted networks only)')
    .action((flags: RunFlags) => run(flags));

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
          ? `Removed AgentDeck hooks from ${result.path}.`
          : `No AgentDeck hooks found in ${result.path}.`,
      );
    });

  const devices = program.command('devices').description('manage paired deck devices');
  devices.command('list').description('list paired devices').action(devicesList);
  devices.command('revoke <id>').description('revoke a paired device').action(devicesRevoke);

  return program;
}

await buildProgram().parseAsync(process.argv);
