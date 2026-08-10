import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors/candidate';

import { runTaze } from './commands/taze.ts';

try {
  process.exitCode = runTaze(process.argv.slice(2));
} catch (error: unknown) {
  reportError(describeError(error));
  process.exitCode = 1;
}
