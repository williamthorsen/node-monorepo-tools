/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { reportOverrides } from './commands/report-overrides.js';
import { findMonorepoRoot } from './context.js';

try {
  const monorepoRoot = findMonorepoRoot();
  reportOverrides(monorepoRoot);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
