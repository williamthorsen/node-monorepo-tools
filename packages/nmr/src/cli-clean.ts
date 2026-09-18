import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { runClean } from './commands/clean.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  await runClean(process.cwd(), resolveBinStyles().stdout);
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
