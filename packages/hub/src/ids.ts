import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** URL-safe secret for pairing tokens and device credentials. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function secretMatchesHash(secret: string, hash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
