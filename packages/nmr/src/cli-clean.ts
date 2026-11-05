import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { runClean } from './commands/clean.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  await runClean(process.cwd(), resolveBinStyles().stdout);
} catch (error: unknown) {
  reportFailure('nmr-clean', error);
  process.exitCode = 1;
}
