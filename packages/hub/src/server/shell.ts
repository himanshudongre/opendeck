import { execa } from 'execa';
import type { CustomAction } from '../config.js';
import { logger } from '../logger.js';

const SHELL_TIMEOUT_MS = 60_000;

/**
 * Runs a config-defined shell action (SPEC §8: defined only in config.json,
 * confirm-gated on the deck — both enforced upstream in the hub core).
 */
export async function runShellAction(
  action: CustomAction,
): Promise<{ ok: boolean; output: string }> {
  const log = logger().child({ component: 'shell', actionId: action.id });
  log.info({ command: action.command }, 'running shell action');
  try {
    const result = await execa(action.command, {
      shell: true,
      ...(action.cwd === undefined ? {} : { cwd: action.cwd }),
      timeout: SHELL_TIMEOUT_MS,
      all: true,
      reject: false,
    });
    const output = result.all;
    log.info({ exitCode: result.exitCode }, 'shell action finished');
    return { ok: result.exitCode === 0, output };
  } catch (error) {
    log.error({ err: error }, 'shell action failed to start');
    return { ok: false, output: error instanceof Error ? error.message : 'failed to start' };
  }
}
