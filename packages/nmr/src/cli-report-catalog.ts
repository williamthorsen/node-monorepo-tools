import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_REPORT_CATALOG_BIN } from './bins.ts';
import { reportCatalog } from './commands/report-catalog.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  // The report goes to stderr, so it takes that stream's style.
  reportCatalog(process.cwd(), resolveBinStyles().stderr);
} catch (error: unknown) {
  reportFailure(NMR_REPORT_CATALOG_BIN, error);
  process.exitCode = 1;
}
