import { execSync } from 'node:child_process';

import { bumpAllVersions } from './bumpAllVersions.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { determineBumpType } from './determineBumpType.ts';
import { generateChangelog } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { parseCommitMessage } from './parseCommitMessage.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import type { MonorepoReleaseConfig, ParsedCommit, ReleaseType } from './types.ts';

/**
 * Orchestrates release preparation for a monorepo with multiple components.
 *
 * For each component in the configuration:
 * 1. Gets path-filtered commits since the last component-specific tag.
 * 2. Determines the bump type from those commits (or uses the override).
 * 3. Bumps all configured package.json version fields.
 * 4. Generates changelogs via git-cliff with `--include-path` filtering.
 *
 * After all components are processed, runs the optional format command once.
 *
 * Note: Each component has its own tag prefix (e.g., 'arrays-v') to isolate its
 * version tags from other components. All components share the same git history,
 * so a commit may appear in multiple components' ranges if it is not filtered by paths.
 *
 * @param config - The monorepo release configuration.
 * @param options - Options controlling dry-run mode and optional bump override.
 */
export function releasePrepareMono(config: MonorepoReleaseConfig, options: ReleasePrepareOptions): string[] {
  const { dryRun, force, bumpOverride } = options;
  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };
  const tags: string[] = [];
  const modifiedFiles: string[] = [];

  for (const component of config.components) {
    const name = component.dir;
    console.info(`\nProcessing component: ${name}`);

    // 1. Get path-filtered commits since last tag
    console.info('  Finding commits since last release...');
    const { tag, commits } = getCommitsSinceTarget(component.tagPrefix, component.paths);
    const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;
    console.info(`  Found ${commits.length} commits ${since}`);

    // Skip components with no changes unless --force is set. "No changes" means
    // no commits touched paths matching the component's glob patterns. Root-level
    // or cross-cutting commits not captured by the component's path globs are not
    // counted and may cause a skip even when those changes semantically apply.
    if (commits.length === 0 && !force) {
      console.info(`  No changes for ${name} ${since}. Skipping.`);
      continue;
    }

    // 2. Determine bump type
    let releaseType: ReleaseType | undefined;

    if (bumpOverride === undefined) {
      const parsedCommits = commits
        .map((c) => parseCommitMessage(c.message, c.hash, workTypes, config.workspaceAliases))
        .filter((c): c is ParsedCommit => c !== undefined);

      console.info(`  Parsed ${parsedCommits.length} typed commits`);
      releaseType = determineBumpType(parsedCommits, workTypes, versionPatterns);
    } else {
      releaseType = bumpOverride;
      console.info(`  Using bump override: ${releaseType}`);
    }

    if (releaseType === undefined) {
      console.info(`  No release-worthy changes for ${name} ${since}. Skipping.`);
      continue;
    }

    // 3. Bump all versions for this component
    console.info(`  Bumping versions (${releaseType})...`);
    const newVersion = bumpAllVersions(component.packageFiles, releaseType, dryRun);
    const newTag = `${component.tagPrefix}${newVersion}`;
    tags.push(newTag);
    modifiedFiles.push(...component.packageFiles, ...component.changelogPaths.map((p) => `${p}/CHANGELOG.md`));

    // 4. Generate changelogs for each configured path with include-path filtering
    console.info('  Generating changelogs...');
    for (const changelogPath of component.changelogPaths) {
      generateChangelog(config, changelogPath, newTag, dryRun, { includePaths: component.paths });
    }
    console.info(`  Component release prepared: ${newTag}`);
  }

  // 5. Run format command once after all components are processed, appending modified file paths
  const formatCommand = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);
  if (tags.length > 0 && formatCommand !== undefined) {
    const fullCommand = `${formatCommand} ${modifiedFiles.join(' ')}`;
    if (dryRun) {
      console.info(`\n  [dry-run] Would run format command: ${fullCommand}`);
    } else {
      console.info(`\n  Running format command: ${fullCommand}`);
      try {
        execSync(fullCommand, { stdio: 'inherit' });
      } catch (error: unknown) {
        throw new Error(
          `Format command failed ('${fullCommand}'): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const summary =
    tags.length > 0 ? 'Monorepo release preparation complete.' : 'No components had release-worthy changes.';
  console.info(`\n${summary}`);
  return tags;
}
