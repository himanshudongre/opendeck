import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import type { WebSocketServer } from 'ws';
import { ClaudeHooksGateway } from '../adapters/claude/hooks.js';
import { ClaudeManagedAdapter } from '../adapters/claude/managed.js';
import { CodexAdapter } from '../adapters/codex/exec.js';
import type { Adapter, DetectResult } from '../adapters/types.js';
import type { HubConfig } from '../config.js';
import { Hub } from '../core/hub.js';
import { logger } from '../logger.js';
import { DeviceStore, PairingManager, RateLimiter } from './auth.js';
import { loadOrCreateCert } from './certs.js';
import { buildApp, registerRoutes, type HttpDeps } from './http.js';
import { lanAddresses, mdnsName } from './net.js';
import { runShellAction } from './shell.js';
import { attachWs } from './ws.js';

export interface StartOptions {
  config: HubConfig;
  version: string;
  port?: number;
  httpsPort?: number;
  localhostOnly?: boolean;
  noAuth?: boolean;
  /** Override deck asset location (tests, dev). */
  deckDir?: string;
  /** Disable the HTTPS lane (tests). */
  httpsLane?: boolean;
  onPaired?: (deviceName: string) => void;
  /** Invoked when a loopback client asks this hub to shut down. */
  onShutdownRequest?: () => void;
}

export interface RunningHub {
  hub: Hub;
  devices: DeviceStore;
  pairing: PairingManager;
  adapters: Adapter[];
  detectAdapters: () => Promise<DetectResult[]>;
  port: number;
  httpsPort: number | undefined;
  host: string;
  lanUrls: string[];
  mdnsUrl: string;
  close: () => Promise<void>;
}

function defaultDeckDir(): string | undefined {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'deck');
  return existsSync(join(dir, 'index.html')) ? dir : undefined;
}

export async function startHub(options: StartOptions): Promise<RunningHub> {
  const log = logger().child({ component: 'start' });
  const { config } = options;
  const authRequired = !(options.noAuth ?? false) && config.auth;
  const localhostOnly = (options.localhostOnly ?? false) || config.bind === 'localhost';
  const host = localhostOnly ? '127.0.0.1' : '0.0.0.0';
  const port = options.port ?? config.port;

  const adapters: Adapter[] = [];
  const hub = new Hub({
    version: options.version,
    customActions: config.customActions,
    runShell: runShellAction,
    spawnSession: async (args) => {
      const harness = args.harness;
      const adapter = adapters.find((entry) => entry.harness === harness);
      if (!adapter) throw new Error(`No adapter for harness ${String(harness)}.`);
      await adapter.spawn({
        cwd: typeof args.cwd === 'string' ? args.cwd : process.cwd(),
        ...(typeof args.prompt === 'string' ? { prompt: args.prompt } : {}),
        ...(typeof args.model === 'string' ? { model: args.model } : {}),
      });
    },
  });
  const claude = new ClaudeManagedAdapter(hub);
  const codex = new CodexAdapter(hub);
  adapters.push(claude, codex);
  const hooksGateway = new ClaudeHooksGateway(hub);
  const devices = new DeviceStore();
  const pairing = new PairingManager();
  const pairingLimiter = new RateLimiter();

  const deckDir = options.deckDir ?? defaultDeckDir();
  const httpDeps: HttpDeps = {
    hub,
    devices,
    pairing,
    pairingLimiter,
    authRequired,
    ...(deckDir === undefined ? {} : { deckDir }),
    ...(options.onPaired === undefined ? {} : { onPaired: options.onPaired }),
    ...(options.onShutdownRequest === undefined
      ? {}
      : { onShutdownRequest: options.onShutdownRequest }),
    claudeHooks: (payload) => hooksGateway.handle(payload),
  };

  const app = await buildApp(httpDeps);
  const sockets: WebSocketServer[] = [];
  const servers: FastifyInstance[] = [app];

  await app.listen({ host, port });
  const boundPort = (app.server.address() as AddressInfo).port;
  sockets.push(attachWs(app.server, { hub, devices, authRequired }));

  const addresses = localhostOnly ? [] : lanAddresses();
  let httpsPort: number | undefined;
  if (options.httpsLane ?? true) {
    try {
      const cert = await loadOrCreateCert(addresses);
      const httpsApp = Fastify({
        logger: false,
        https: { cert: cert.cert, key: cert.key },
      });
      await registerRoutes(httpsApp, httpDeps);
      await httpsApp.listen({ host, port: options.httpsPort ?? config.httpsPort });
      sockets.push(attachWs(httpsApp.server, { hub, devices, authRequired }));
      servers.push(httpsApp);
      httpsPort = (httpsApp.server.address() as AddressInfo).port;
    } catch (error) {
      // The HTTP lane is the product; the HTTPS lane (voice/wake-lock) degrades away.
      log.warn({ err: error }, 'https lane unavailable');
    }
  }

  return {
    hub,
    devices,
    pairing,
    adapters,
    detectAdapters: () => Promise.all(adapters.map((adapter) => adapter.detect())),
    port: boundPort,
    httpsPort,
    host,
    lanUrls: addresses.map((ip) => `http://${ip}:${boundPort}`),
    mdnsUrl: `http://${mdnsName()}:${boundPort}`,
    close: async () => {
      await Promise.all(adapters.map((adapter) => adapter.dispose()));
      for (const wss of sockets) {
        for (const client of wss.clients) client.terminate();
        wss.close();
      }
      await Promise.all(servers.map((server) => server.close()));
    },
  };
}
