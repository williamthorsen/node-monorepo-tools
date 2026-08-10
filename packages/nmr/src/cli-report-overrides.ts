import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors/candidate';

import { reportOverrides } from './commands/report-overrides.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  reportOverrides(monorepoRoot);
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
