import { reportError } from '@williamthorsen/nmr-core';

import { syncPnpmVersion } from './commands/sync-pnpm-version.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  const monorepoRoot = findMonorepoRoot();
  syncPnpmVersion(monorepoRoot);
} catch (error) {
  reportError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
