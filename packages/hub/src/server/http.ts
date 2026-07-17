import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { PROTOCOL_VERSION } from '@agentdeck/protocol';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Hub } from '../core/hub.js';
import { logger } from '../logger.js';
import type { DeviceStore, PairingManager, RateLimiter } from './auth.js';

export interface HttpDeps {
  hub: Hub;
  devices: DeviceStore;
  pairing: PairingManager;
  pairingLimiter: RateLimiter;
  authRequired: boolean;
  /** Absolute path to the built deck assets; undefined in source checkouts before a build. */
  deckDir?: string;
  onPaired?: (deviceName: string) => void;
  /** Claude Code hook POSTs land here (observed sessions, SPEC §4.1). */
  claudeHooks?: (payload: unknown) => Promise<HookGatewayResponse>;
}

export interface HookGatewayResponse {
  status: 200 | 204;
  body?: Record<string, unknown>;
}

const PairBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(80),
});

export function authenticateRequest(req: FastifyRequest, deps: HttpDeps): boolean {
  if (!deps.authRequired) return true;
  const deviceId = req.headers['x-agentdeck-device'];
  const credential = req.headers['x-agentdeck-credential'];
  if (typeof deviceId !== 'string' || typeof credential !== 'string') return false;
  return deps.devices.authenticate(deviceId, credential) !== undefined;
}

const MISSING_DECK_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>AgentDeck</title></head>
  <body style="font-family: system-ui; background: #0e0f12; color: #e9ebee; display: grid; place-items: center; min-height: 100vh; margin: 0">
    <main style="max-width: 32rem; padding: 2rem">
      <h1 style="font-size: 1.25rem">Deck assets not found</h1>
      <p style="color: #9ba1ac">
        This hub is running from a source checkout without a deck build.
        Run <code>pnpm build</code> in the repository, then restart the hub.
        Installed via npm? Reinstall with <code>npx agent-deck@latest</code>.
      </p>
    </main>
  </body>
</html>`;

export async function buildApp(deps: HttpDeps): Promise<FastifyInstance> {
  // Fastify's own request logging is off: hub logging goes through the pino
  // instance in logger.ts, whose generics fastify's types refuse to carry.
  const app = Fastify({ logger: false });
  await registerRoutes(app, deps);
  return app;
}

export async function registerRoutes(app: FastifyInstance, deps: HttpDeps): Promise<void> {
  const log = logger().child({ component: 'http' });

  app.get('/api/health', () => ({
    ok: true,
    hubId: deps.hub.hubId,
    version: deps.hub.version,
    protocolVersion: PROTOCOL_VERSION,
  }));

  app.post('/api/pair', (req, reply) => {
    if (!deps.pairingLimiter.allow(req.ip)) {
      log.warn({ ip: req.ip }, 'pairing rate limit hit');
      return reply
        .status(429)
        .send({ error: 'Too many pairing attempts. Wait a minute and retry.' });
    }
    const body = PairBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Pairing needs a token and a device name.' });
    }
    if (!deps.pairing.consume(body.data.token)) {
      return reply
        .status(403)
        .send({ error: 'Pairing token is invalid or expired. Scan the QR code again.' });
    }
    const { device, credential } = deps.devices.register(body.data.name);
    log.info({ deviceId: device.id, name: device.name }, 'device paired');
    deps.onPaired?.(device.name);
    return reply.send({
      deviceId: device.id,
      credential,
      hubId: deps.hub.hubId,
      hubVersion: deps.hub.version,
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  if (deps.claudeHooks !== undefined) {
    const claudeHooks = deps.claudeHooks;
    app.post('/api/hooks/claude', async (req, reply) => {
      // Hooks come from CLIs on this machine, never from paired devices.
      if (req.ip !== '127.0.0.1' && req.ip !== '::1') {
        return reply
          .status(403)
          .send({ error: 'Hook events are accepted from this machine only.' });
      }
      const result = await claudeHooks(req.body);
      if (result.status === 200 && result.body !== undefined) {
        return reply.status(200).send(result.body);
      }
      return reply.status(204).send();
    });
  }

  app.get('/api/snapshot', (req, reply) => {
    if (!authenticateRequest(req, deps)) {
      return reply.status(401).send({ error: 'Unknown device. Pair again from the QR code.' });
    }
    return reply.send({ sessions: deps.hub.snapshot(), seq: deps.hub.currentSeq() });
  });

  if (deps.deckDir && existsSync(deps.deckDir)) {
    await app.register(fastifyStatic, { root: deps.deckDir, index: 'index.html' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
        return reply.status(404).send({ error: 'Not found.' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', (_req, reply) => reply.type('text/html').send(MISSING_DECK_PAGE));
  }
}
