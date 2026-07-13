import { reportError } from '@williamthorsen/nmr-core';

import { runClean } from './commands/clean.ts';

try {
  await runClean(process.cwd());
} catch (error) {
  reportError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
