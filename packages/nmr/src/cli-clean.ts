import { reportError } from '@williamthorsen/nmr-core';

import { cleanPackage } from './commands/clean.ts';

try {
  await cleanPackage(process.cwd());
} catch (error) {
  reportError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
