import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_REPORT_OVERRIDES_BIN } from './bins.ts';
import { reportOverrides } from './commands/report-overrides.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  // The report goes to stderr, so it takes that stream's style.
  reportOverrides(monorepoRoot, resolveBinStyles().stderr);
} catch (error: unknown) {
  reportFailure(NMR_REPORT_OVERRIDES_BIN, error);
  process.exitCode = 1;
}
