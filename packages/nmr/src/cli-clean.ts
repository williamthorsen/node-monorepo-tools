import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors/candidate';

import { runClean } from './commands/clean.ts';

try {
  await runClean(process.cwd());
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
