import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { reportCatalog } from './commands/report-catalog.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  // The report goes to stderr, so it takes that stream's style.
  reportCatalog(process.cwd(), resolveBinStyles().stderr);
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
