/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { reportOverrides } from './commands/report-overrides.ts';
import { findMonorepoRoot } from './context.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  reportOverrides(monorepoRoot);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
