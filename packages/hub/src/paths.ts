import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Everything AgentDeck persists lives under one hand-editable directory
 * (SPEC §8). Overridable for tests via AGENTDECK_HOME.
 */
export function agentdeckHome(): string {
  return process.env.AGENTDECK_HOME ?? join(homedir(), '.agentdeck');
}

export function configPath(): string {
  return join(agentdeckHome(), 'config.json');
}

export function devicesPath(): string {
  return join(agentdeckHome(), 'devices.json');
}

export function certDir(): string {
  return join(agentdeckHome(), 'cert');
}

export function logsDir(): string {
  return join(agentdeckHome(), 'logs');
}
