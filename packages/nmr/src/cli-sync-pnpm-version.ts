/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { syncPnpmVersion } from './commands/sync-pnpm-version.ts';
import { findMonorepoRoot } from './context.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  syncPnpmVersion(monorepoRoot);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
