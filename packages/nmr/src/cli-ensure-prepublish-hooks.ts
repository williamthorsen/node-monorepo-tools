import { parseArgsOrExit, reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { DEFAULT_HOOK, ensurePrepublishHooks, reportPrepublishHooks } from './commands/ensure-prepublish-hooks.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';
import { findMonorepoRoot } from './workspace.ts';

const flagSchema = {
  fix: { long: '--fix', type: 'boolean' as const },
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  command: { long: '--command', type: 'string' as const },
};

const { fix, dryRun, command } = parseArgsOrExit(process.argv.slice(2), flagSchema).flags;

try {
  // Resolved ahead of the work, so a variable naming no style is rejected before `--fix` writes anything.
  const { stdout } = resolveBinStyles();
  const monorepoRoot = findMonorepoRoot();
  const options = command ? { fix, dryRun, command } : { fix, dryRun };
  const result = ensurePrepublishHooks(monorepoRoot, options);

  reportPrepublishHooks(result, command ?? DEFAULT_HOOK, stdout);

  if (result.hasFailures) {
    process.exitCode = 1;
  }
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
