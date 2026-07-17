import type { Credentials } from './connection.js';

const STORAGE_KEY = 'opendeck.pairing';

export interface StoredPairing extends Credentials {
  hubId: string;
}

export function readPairing(): StoredPairing | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredPairing>;
    if (
      typeof parsed.deviceId === 'string' &&
      typeof parsed.credential === 'string' &&
      typeof parsed.hubId === 'string'
    ) {
      return { deviceId: parsed.deviceId, credential: parsed.credential, hubId: parsed.hubId };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function savePairing(pairing: StoredPairing): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
}

export function clearPairing(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** `#pair=<token>` from the QR code URL; consumed once then scrubbed. */
export function pairingTokenFromHash(hash: string): string | undefined {
  const match = /#pair=([A-Za-z0-9_-]+)/.exec(hash);
  return match?.[1];
}

export function deviceName(userAgent: string): string {
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/Android/i.test(userAgent) && /Mobile/i.test(userAgent)) return 'Android phone';
  if (/Android/i.test(userAgent)) return 'Android tablet';
  if (/Macintosh/i.test(userAgent)) return 'Mac browser';
  if (/Windows/i.test(userAgent)) return 'Windows browser';
  if (/Linux/i.test(userAgent)) return 'Linux browser';
  return 'Browser';
}

export type PairResult = { ok: true; pairing: StoredPairing } | { ok: false; message: string };

export async function pairWithToken(
  baseUrl: string,
  token: string,
  name: string,
  fetchFn: typeof fetch = fetch,
): Promise<PairResult> {
  let response: Response;
  try {
    response = await fetchFn(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name }),
    });
  } catch {
    return { ok: false, message: 'Could not reach the hub. Is it still running?' };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      message: body.error ?? 'Pairing failed. Scan a fresh QR code from the hub terminal.',
    };
  }
  const body = (await response.json()) as {
    deviceId: string;
    credential: string;
    hubId: string;
  };
  const pairing: StoredPairing = {
    deviceId: body.deviceId,
    credential: body.credential,
    hubId: body.hubId,
  };
  savePairing(pairing);
  return { ok: true, pairing };
}
