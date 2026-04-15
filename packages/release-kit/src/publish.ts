import { execFileSync } from 'node:child_process';

import type { PackageManager } from './detectPackageManager.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';

export interface PublishOptions {
  dryRun: boolean;
  noGitChecks: boolean;
  provenance: boolean;
}

/** Publish a single package by running `{pm} publish` from its workspace directory. */
export function publishPackage(
  resolvedTag: ResolvedTag,
  packageManager: PackageManager,
  options: PublishOptions,
): void {
  const { dryRun, noGitChecks, provenance } = options;
  const executable = resolveExecutable(packageManager);
  const args = buildPublishArgs(packageManager, { dryRun, noGitChecks, provenance });

  console.info(
    `\n${dryRun ? '[dry-run] ' : ''}Running: ${executable} ${args.join(' ')} (cwd: ${resolvedTag.workspacePath})`,
  );
  execFileSync(executable, args, { cwd: resolvedTag.workspacePath, stdio: 'inherit' });
}

/** Map the `PackageManager` value to the actual CLI executable name. */
function resolveExecutable(packageManager: PackageManager): string {
  if (packageManager === 'yarn-berry') {
    return 'yarn';
  }
  return packageManager;
}

/** Build the argument list for the publish command. */
function buildPublishArgs(packageManager: PackageManager, options: PublishOptions): string[] {
  const args = packageManager === 'yarn-berry' ? ['npm', 'publish'] : ['publish'];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  if (options.noGitChecks && packageManager === 'pnpm') {
    args.push('--no-git-checks');
  }

  // Classic yarn does not support --provenance
  if (options.provenance && packageManager !== 'yarn') {
    args.push('--provenance');
  }

  return args;
}
