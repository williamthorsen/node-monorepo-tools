import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_CLEAN_BIN } from './bins.ts';
import { runClean } from './commands/clean.ts';

try {
  process.exitCode = await runClean(process.argv.slice(2), process.cwd());
} catch (error: unknown) {
  reportFailure(NMR_CLEAN_BIN, error);
  process.exitCode = 1;
}
