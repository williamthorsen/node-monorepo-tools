import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_TAZE_BIN } from './bins.ts';
import { runTaze } from './commands/taze.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  process.exitCode = await runTaze(process.argv.slice(2), { stderrStyle: resolveBinStyles().stderr });
} catch (error: unknown) {
  reportFailure(NMR_TAZE_BIN, error);
  process.exitCode = 1;
}
