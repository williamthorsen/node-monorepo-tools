import { parseArgsOrExit, reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { DEFAULT_HOOK, ensurePrepublishHooks, reportPrepublishHooks } from './commands/ensure-prepublish-hooks.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';
import { findMonorepoRoot } from './workspace.ts';

const flagSchema = {
  shouldFix: { long: '--fix', type: 'boolean' as const },
  isDryRun: { long: '--dry-run', type: 'boolean' as const },
  command: { long: '--command', type: 'string' as const },
};

const { shouldFix, isDryRun, command } = parseArgsOrExit(process.argv.slice(2), flagSchema).flags;

try {
  // Resolved ahead of the work, so a variable naming no style is rejected before `--fix` writes anything.
  const { stdout } = resolveBinStyles();
  const monorepoRoot = findMonorepoRoot();
  const options = command ? { shouldFix, isDryRun, command } : { shouldFix, isDryRun };
  const result = ensurePrepublishHooks(monorepoRoot, options);

  reportPrepublishHooks(result, command ?? DEFAULT_HOOK, stdout);

  if (result.hasFailures) {
    process.exitCode = 1;
  }
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
