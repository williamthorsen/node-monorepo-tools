import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { reportOverrides } from './commands/report-overrides.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  // The report goes to stderr, so it takes that stream's style.
  reportOverrides(monorepoRoot, resolveBinStyles().stderr);
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
