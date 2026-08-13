import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { reportCatalog } from './commands/report-catalog.ts';

try {
  reportCatalog(process.cwd());
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
