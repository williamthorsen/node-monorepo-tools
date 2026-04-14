import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractVersion, readChangelogEntries } from './changelogJsonUtils.ts';
import type { PackageManager } from './detectPackageManager.ts';
import { injectSection } from './injectSection.ts';
import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';
import type { ReleaseNotesConfig } from './types.ts';

export interface PublishOptions {
  dryRun: boolean;
  noGitChecks: boolean;
  provenance: boolean;
  releaseNotes?: ReleaseNotesConfig;
  changelogJsonOutputPath?: string;
}

/**
 * Publish resolved packages by running `{pm} publish` from each package directory.
 *
 * Prints a confirmation listing all packages before publishing begins. Exits on first failure,
 * reporting which packages were successfully published before the error.
 */
export function publish(resolvedTags: ResolvedTag[], packageManager: PackageManager, options: PublishOptions): void {
  const { dryRun, noGitChecks, provenance } = options;

  if (resolvedTags.length === 0) {
    return;
  }

  console.info(dryRun ? '[dry-run] Would publish:' : 'Publishing:');
  for (const { tag, workspacePath } of resolvedTags) {
    console.info(`  ${tag} (${workspacePath})`);
  }

  const published: string[] = [];
  const executable = resolveExecutable(packageManager);
  const args = buildPublishArgs(packageManager, { dryRun, noGitChecks, provenance });

  const shouldInject = options.releaseNotes?.shouldInjectIntoReadme === true;
  const changelogJsonOutputPath = options.changelogJsonOutputPath ?? '.meta/changelog.json';

  for (const { tag, workspacePath } of resolvedTags) {
    let readmePath: string | undefined;
    let originalReadme: string | undefined;

    if (shouldInject) {
      readmePath = resolveReadmePath(workspacePath);
      if (readmePath !== undefined) {
        originalReadme = injectReleaseNotesIntoReadme(readmePath, join(workspacePath, changelogJsonOutputPath), tag);
      }
    }

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
    } finally {
      if (readmePath !== undefined && originalReadme !== undefined) {
        writeFileSync(readmePath, originalReadme, 'utf8');
      }
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

/** Find the README file in a workspace directory. */
function resolveReadmePath(workspacePath: string): string | undefined {
  const readmePath = join(workspacePath, 'README.md');
  if (existsSync(readmePath)) {
    return readmePath;
  }
  return undefined;
}

/**
 * Inject release notes into a README and return the original content for restoration.
 *
 * Returns the original README content, or `undefined` if injection was skipped.
 */
function injectReleaseNotesIntoReadme(readmePath: string, changelogJsonPath: string, tag: string): string | undefined {
  if (!existsSync(changelogJsonPath)) {
    console.warn(`Warning: ${changelogJsonPath} not found; skipping README injection`);
    return undefined;
  }

  const originalReadme = readFileSync(readmePath, 'utf8');

  const version = extractVersion(tag);
  const entries = readChangelogEntries(changelogJsonPath);
  if (entries === undefined) {
    return undefined;
  }

  const entry = entries.find((e) => e.version === version);
  if (entry === undefined) {
    console.warn(`Warning: no changelog entry for version ${version}; skipping README injection`);
    return undefined;
  }

  const releaseNotesMarkdown = renderReleaseNotesSingle(entry, {
    filter: matchesAudience('all'),
    includeHeading: false,
  });

  const injected = injectSection(originalReadme, 'release-notes', releaseNotesMarkdown.trimEnd());
  writeFileSync(readmePath, injected, 'utf8');

  return originalReadme;
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
