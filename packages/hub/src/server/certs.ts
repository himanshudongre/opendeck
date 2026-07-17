import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { certDir } from '../paths.js';

export interface CertPair {
  cert: string;
  key: string;
}

interface AltName {
  type: 1 | 2 | 6 | 7;
  value?: string;
  ip?: string;
}

/**
 * Generates (once) and persists a self-signed cert for the HTTPS lane on
 * :3326 (SPEC §5.5) — browsers gate mic and Wake Lock behind secure contexts.
 * The user trusts it one time from Settings → "Enable voice".
 */
export async function loadOrCreateCert(lanAddresses: string[]): Promise<CertPair> {
  const dir = certDir();
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');
  try {
    return { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') };
  } catch {
    // Fall through to generation on first run.
  }

  const host = hostname();
  const altNames: AltName[] = [
    { type: 2, value: 'localhost' },
    { type: 2, value: `${host.replace(/\.$/, '')}.local` },
    { type: 7, ip: '127.0.0.1' },
    ...lanAddresses.map((ip): AltName => ({ type: 7, ip })),
  ];
  const tenYears = new Date();
  tenYears.setFullYear(tenYears.getFullYear() + 10);
  const pems = await generate([{ name: 'commonName', value: 'opendeck' }], {
    notAfterDate: tenYears,
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'subjectAltName', altNames },
    ],
  });

  mkdirSync(dir, { recursive: true });
  writeFileSync(certPath, pems.cert);
  writeFileSync(keyPath, pems.private);
  return { cert: pems.cert, key: pems.private };
}
