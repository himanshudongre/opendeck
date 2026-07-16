import { networkInterfaces, hostname } from 'node:os';

/** Non-internal IPv4 addresses, LAN-facing first. */
export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

export function mdnsName(): string {
  const host = hostname();
  return host.endsWith('.local') ? host : `${host.replace(/\.$/, '')}.local`;
}
