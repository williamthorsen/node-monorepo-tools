import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { runTaze } from './commands/taze.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  process.exitCode = await runTaze(process.argv.slice(2), { stderrStyle: resolveBinStyles().stderr });
} catch (error: unknown) {
  reportError(describeError(error));
  process.exitCode = 1;
}
