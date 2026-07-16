import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceStore,
  PAIRING_TOKEN_TTL_MS,
  PairingManager,
  RateLimiter,
} from '../src/server/auth.js';
import { loadConfig } from '../src/config.js';
import { configPath, devicesPath } from '../src/paths.js';
import { tempHome } from './helpers.js';

let restoreHome: () => void;
beforeEach(() => {
  restoreHome = tempHome();
});
afterEach(() => {
  restoreHome();
});

describe('DeviceStore', () => {
  it('registers devices and authenticates only the right credential', () => {
    const store = new DeviceStore();
    const { device, credential } = store.register('iPad');

    expect(store.authenticate(device.id, credential)?.name).toBe('iPad');
    expect(store.authenticate(device.id, 'wrong-secret')).toBeUndefined();
    expect(store.authenticate('ghost', credential)).toBeUndefined();
  });

  it('persists hashed credentials to devices.json, never plaintext', () => {
    const store = new DeviceStore();
    const { credential } = store.register('Pixel');

    const raw = readFileSync(devicesPath(), 'utf8');
    expect(raw).not.toContain(credential);

    const reloaded = new DeviceStore();
    expect(reloaded.list()).toHaveLength(1);
  });

  it('revokes devices', () => {
    const store = new DeviceStore();
    const { device, credential } = store.register('iPhone');
    expect(store.revoke(device.id)).toBe(true);
    expect(store.revoke(device.id)).toBe(false);
    expect(store.authenticate(device.id, credential)).toBeUndefined();
    expect(new DeviceStore().list()).toHaveLength(0);
  });

  it('recovers from a corrupt devices.json', () => {
    mkdirSync(dirname(devicesPath()), { recursive: true });
    writeFileSync(devicesPath(), 'not json');
    const store = new DeviceStore();
    expect(store.list()).toHaveLength(0);
    store.register('Tab S9');
    expect(new DeviceStore().list()).toHaveLength(1);
  });
});

describe('PairingManager', () => {
  it('accepts a token exactly once', () => {
    const pairing = new PairingManager();
    const token = pairing.issueToken();
    expect(pairing.consume(token)).toBe(true);
    expect(pairing.consume(token)).toBe(false);
  });

  it('rejects unknown tokens', () => {
    const pairing = new PairingManager();
    expect(pairing.consume('never-issued')).toBe(false);
  });

  it('expires tokens after ten minutes', () => {
    let now = 0;
    const pairing = new PairingManager(() => now);
    const token = pairing.issueToken();

    now = PAIRING_TOKEN_TTL_MS - 1;
    const fresh = pairing.issueToken();
    expect(pairing.consume(token)).toBe(true);

    now = PAIRING_TOKEN_TTL_MS - 1 + PAIRING_TOKEN_TTL_MS + 1;
    expect(pairing.consume(fresh)).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit inside the window, then refuses', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 1000, () => now);
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(false);
    expect(limiter.allow('other-ip')).toBe(true);

    now = 1001;
    expect(limiter.allow('ip')).toBe(true);
  });
});

describe('loadConfig', () => {
  it('returns defaults when config.json is absent', () => {
    const result = loadConfig();
    expect(result.ok).toBe(true);
    expect(result.config.port).toBe(3325);
    expect(result.config.bind).toBe('lan');
  });

  it('reads a valid config.json', () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(
      configPath(),
      JSON.stringify({
        port: 4000,
        customActions: [{ id: 'tests', label: 'Run tests', command: 'pnpm test' }],
      }),
    );
    const result = loadConfig();
    expect(result.ok).toBe(true);
    expect(result.config.port).toBe(4000);
    expect(result.config.customActions).toHaveLength(1);
  });

  it('reports invalid JSON and falls back to defaults', () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), '{ nope');
    const result = loadConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('not valid JSON');
    expect(result.config.port).toBe(3325);
  });

  it('reports schema problems with their path', () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ port: 'not-a-number' }));
    const result = loadConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('port');
  });

  it('labels top-level type problems as (root)', () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), '42');
    const result = loadConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('(root)');
  });
});
