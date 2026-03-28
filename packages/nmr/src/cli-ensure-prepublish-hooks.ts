/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { DEFAULT_HOOK, ensurePrepublishHooks } from './commands/ensure-prepublish-hooks.js';
import { findMonorepoRoot } from './context.js';

let fix = false;
let dryRun = false;
let command: string | undefined;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '--fix':
      fix = true;

      break;

    case '--dry-run':
      dryRun = true;

      break;

    case '--command':
      i++;
      command = args[i];
      if (!command) {
        console.error('--command requires a value');
        process.exit(1);
      }

      break;

    default:
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
  }
}

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
    console.error(`\n${missing} package(s) missing prepublishOnly. Use --fix to add it.`);
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
