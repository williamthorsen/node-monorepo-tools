/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { syncPnpmVersion } from './commands/sync-pnpm-version.js';
import { findMonorepoRoot } from './context.js';

try {
  const monorepoRoot = findMonorepoRoot();
  syncPnpmVersion(monorepoRoot);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
