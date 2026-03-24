import { execFileSync } from 'node:child_process';

import type { PackageManager } from './detectPackageManager.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';

export interface PublishOptions {
  dryRun: boolean;
  noGitChecks: boolean;
}

/**
 * Publish resolved packages by running `{pm} publish` from each package directory.
 *
 * Prints a confirmation listing all packages before publishing begins. Exits on first failure,
 * reporting which packages were successfully published before the error.
 */
export function publish(resolvedTags: ResolvedTag[], packageManager: PackageManager, options: PublishOptions): void {
  const { dryRun, noGitChecks } = options;

  if (resolvedTags.length === 0) {
    return;
  }

  console.info(dryRun ? '[dry-run] Would publish:' : 'Publishing:');
  for (const { tag, workspacePath } of resolvedTags) {
    console.info(`  ${tag} (${workspacePath})`);
  }

  const published: string[] = [];

  for (const { tag, workspacePath } of resolvedTags) {
    const executable = resolveExecutable(packageManager);
    const args = buildPublishArgs(packageManager, { dryRun, noGitChecks });

    try {
      console.info(`\n${dryRun ? '[dry-run] ' : ''}Running: ${executable} ${args.join(' ')} (cwd: ${workspacePath})`);
      execFileSync(executable, args, { cwd: workspacePath, stdio: 'inherit' });
      published.push(tag);
    } catch (error: unknown) {
      if (published.length > 0) {
        console.warn('Packages published before failure:');
        for (const t of published) {
          console.warn(`  ${t}`);
        }
      }
      throw error;
    }
  }
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

  return args;
}
