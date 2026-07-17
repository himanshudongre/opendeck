import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { hashSecret, newId, newSecret, secretMatchesHash } from '../ids.js';
import { devicesPath } from '../paths.js';

export const DeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  credentialHash: z.string().min(1),
  createdAt: z.number(),
  lastSeenAt: z.number(),
});
export type Device = z.infer<typeof DeviceSchema>;

const DeviceFileSchema = z.object({ devices: z.array(DeviceSchema) });

export const PAIRING_TOKEN_TTL_MS = 10 * 60 * 1000;

interface PairingToken {
  token: string;
  expiresAt: number;
}

/**
 * Paired-device credentials (SPEC §8). Tokens are one-time and 10-minute
 * expiring; credentials are long-lived, stored hashed on disk, revocable via
 * `opendeck devices revoke`.
 */
export class DeviceStore {
  private devices: Device[] = [];
  private readonly path: string;

  constructor(private readonly now: () => number = Date.now) {
    this.path = devicesPath();
    this.load();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch {
      this.devices = [];
      return;
    }
    try {
      this.devices = DeviceFileSchema.parse(JSON.parse(raw)).devices;
    } catch {
      // A corrupt devices.json must not brick the hub; pairing re-creates entries.
      this.devices = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify({ devices: this.devices }, null, 2)}\n`);
  }

  register(name: string): { device: Device; credential: string } {
    const credential = newSecret();
    const device: Device = {
      id: newId('device'),
      name,
      credentialHash: hashSecret(credential),
      createdAt: this.now(),
      lastSeenAt: this.now(),
    };
    this.devices.push(device);
    this.save();
    return { device, credential };
  }

  authenticate(deviceId: string, credential: string): Device | undefined {
    const device = this.devices.find((entry) => entry.id === deviceId);
    if (!device || !secretMatchesHash(credential, device.credentialHash)) return undefined;
    device.lastSeenAt = this.now();
    this.save();
    return device;
  }

  list(): Device[] {
    return [...this.devices];
  }

  revoke(deviceId: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((entry) => entry.id !== deviceId);
    if (this.devices.length === before) return false;
    this.save();
    return true;
  }
}

export class PairingManager {
  private tokens: PairingToken[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  issueToken(): string {
    const token = newSecret(16);
    this.tokens.push({ token, expiresAt: this.now() + PAIRING_TOKEN_TTL_MS });
    return token;
  }

  /** One-time: a successful consume burns the token. */
  consume(token: string): boolean {
    this.tokens = this.tokens.filter((entry) => entry.expiresAt > this.now());
    const index = this.tokens.findIndex((entry) => entry.token === token);
    if (index === -1) return false;
    this.tokens.splice(index, 1);
    return true;
  }
}

/** Sliding-window limiter for pairing attempts (SPEC §8). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    return true;
  }
}
