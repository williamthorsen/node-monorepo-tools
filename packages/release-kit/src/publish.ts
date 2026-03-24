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
    const args = buildPublishArgs(packageManager, { dryRun, noGitChecks });

    try {
      console.info(
        `\n${dryRun ? '[dry-run] ' : ''}Running: ${packageManager} ${args.join(' ')} (cwd: ${workspacePath})`,
      );
      execFileSync(packageManager, args, { cwd: workspacePath, stdio: 'inherit' });
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

/** Build the argument list for `{pm} publish`. */
function buildPublishArgs(
  packageManager: PackageManager,
  options: { dryRun: boolean; noGitChecks: boolean },
): string[] {
  const args = ['publish'];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  if (options.noGitChecks && packageManager === 'pnpm') {
    args.push('--no-git-checks');
  }

  return args;
}
