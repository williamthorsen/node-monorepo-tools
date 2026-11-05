import { reportFailure } from '@williamthorsen/nmr-core';

import { reportOverrides } from './commands/report-overrides.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  // The report goes to stderr, so it takes that stream's style.
  reportOverrides(monorepoRoot, resolveBinStyles().stderr);
} catch (error: unknown) {
  reportFailure('nmr-report-overrides', error);
  process.exitCode = 1;
}
