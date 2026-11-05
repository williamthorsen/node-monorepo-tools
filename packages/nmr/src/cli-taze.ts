import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { runTaze } from './commands/taze.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  process.exitCode = await runTaze(process.argv.slice(2), { stderrStyle: resolveBinStyles().stderr });
} catch (error: unknown) {
  reportFailure('nmr-taze', error);
  process.exitCode = 1;
}
