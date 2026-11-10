import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_REPORT_OVERRIDES_BIN } from './bins.ts';
import { runReportOverrides } from './commands/report-overrides.ts';

try {
  process.exitCode = await runReportOverrides(process.argv.slice(2), process.cwd());
} catch (error: unknown) {
  reportFailure(NMR_REPORT_OVERRIDES_BIN, error);
  process.exitCode = 1;
}
