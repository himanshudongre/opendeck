import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../src/logger.js';

// The pino instance is memoized on first use and holds an open file handle.
// Create it once under a run-stable home so per-test temp homes (created and
// removed by tempHome()) never yank the log directory out from under it.
process.env.OPENDECK_HOME = mkdtempSync(join(tmpdir(), 'opendeck-vitest-'));
logger();
