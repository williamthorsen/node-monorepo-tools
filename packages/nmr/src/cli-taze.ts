import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';

import { runTaze } from './commands/taze.ts';

try {
  process.exitCode = runTaze(process.argv.slice(2));
} catch (error: unknown) {
  reportError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
