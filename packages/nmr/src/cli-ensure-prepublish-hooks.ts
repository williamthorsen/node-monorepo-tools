import { parseArgsOrExit, reportError } from '@williamthorsen/nmr-core';

import { DEFAULT_HOOK, ensurePrepublishHooks } from './commands/ensure-prepublish-hooks.ts';
import { findMonorepoRoot } from './context.ts';

const flagSchema = {
  fix: { long: '--fix', type: 'boolean' as const },
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  command: { long: '--command', type: 'string' as const },
};

const { fix, dryRun, command } = parseArgsOrExit(process.argv.slice(2), flagSchema).flags;

try {
  const monorepoRoot = findMonorepoRoot();
  const hookCommand = command ?? DEFAULT_HOOK;
  const options = command ? { fix, dryRun, command } : { fix, dryRun };
  const result = ensurePrepublishHooks(monorepoRoot, options);

  for (const pkg of result.packages) {
    if (pkg.isPrivate) {
      continue;
    }

    switch (pkg.action) {
      case 'ok':
        console.info(`✓ ${pkg.packageName}: prepublishOnly = "${pkg.prepublishOnly}"`);
        break;
      case 'missing':
        console.warn(`✗ ${pkg.packageName}: missing prepublishOnly`);
        break;
      case 'fixed':
        console.info(`✓ ${pkg.packageName}: added prepublishOnly = "${hookCommand}"`);
        break;
      case 'would-fix':
        console.info(`~ ${pkg.packageName}: would add prepublishOnly = "${hookCommand}"`);
        break;
    }
  }

  if (result.hasFailures) {
    const missing = result.packages.filter((p) => p.action === 'missing').length;
    process.stderr.write(`\n${missing} package(s) missing prepublishOnly. Use --fix to add it.\n`);
    process.exitCode = 1;
  }
} catch (error) {
  reportError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
