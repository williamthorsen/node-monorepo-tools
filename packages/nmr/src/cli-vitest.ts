import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { runNmrVitest } from './commands/run-vitest.ts';

try {
  process.exitCode = runNmrVitest(process.argv.slice(2), process.cwd());
} catch (error: unknown) {
  reportFailure('nmr-vitest', error);
  process.exitCode = 1;
}
