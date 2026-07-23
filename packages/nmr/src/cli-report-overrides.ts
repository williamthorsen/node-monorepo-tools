import { reportError } from '@williamthorsen/nmr-core';

import { reportOverrides } from './commands/report-overrides.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  reportOverrides(monorepoRoot);
} catch (error) {
  reportError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
