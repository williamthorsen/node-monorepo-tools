import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_VITEST_BIN } from './bins.ts';
import { runNmrVitest } from './commands/run-vitest.ts';

try {
  process.exitCode = runNmrVitest(process.argv.slice(2), process.cwd());
} catch (error: unknown) {
  reportFailure(NMR_VITEST_BIN, error);
  process.exitCode = 1;
}
