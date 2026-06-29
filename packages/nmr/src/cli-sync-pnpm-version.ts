/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { reportError } from '@williamthorsen/nmr-core';

import { syncPnpmVersion } from './commands/sync-pnpm-version.ts';
import { findMonorepoRoot } from './context.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  syncPnpmVersion(monorepoRoot);
} catch (error) {
  reportError(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
