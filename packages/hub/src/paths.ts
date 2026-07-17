import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Everything OpenDeck persists lives under one hand-editable directory
 * (SPEC §8). Overridable for tests via OPENDECK_HOME.
 */
export function opendeckHome(): string {
  return process.env.OPENDECK_HOME ?? join(homedir(), '.opendeck');
}

export function configPath(): string {
  return join(opendeckHome(), 'config.json');
}

export function devicesPath(): string {
  return join(opendeckHome(), 'devices.json');
}

export function certDir(): string {
  return join(opendeckHome(), 'cert');
}

export function logsDir(): string {
  return join(opendeckHome(), 'logs');
}
