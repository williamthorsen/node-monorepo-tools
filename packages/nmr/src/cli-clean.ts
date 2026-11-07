import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_CLEAN_BIN } from './bins.ts';
import { runClean } from './commands/clean.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  await runClean(process.cwd(), resolveBinStyles().stdout);
} catch (error: unknown) {
  reportFailure(NMR_CLEAN_BIN, error);
  process.exitCode = 1;
}
