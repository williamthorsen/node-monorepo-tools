import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_REPORT_CATALOG_BIN } from './bins.ts';
import { runReportCatalog } from './commands/report-catalog.ts';

try {
  process.exitCode = await runReportCatalog(process.argv.slice(2), process.cwd());
} catch (error: unknown) {
  reportFailure(NMR_REPORT_CATALOG_BIN, error);
  process.exitCode = 1;
}
