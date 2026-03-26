import { execSync } from 'node:child_process';

import { bumpAllVersions } from './bumpAllVersions.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { determineBumpType } from './determineBumpType.ts';
import { generateChangelog } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { parseCommitMessage } from './parseCommitMessage.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import type {
  ComponentPrepareResult,
  MonorepoReleaseConfig,
  ParsedCommit,
  PrepareResult,
  ReleaseType,
} from './types.ts';

/**
 * Orchestrate release preparation for a monorepo with multiple components.
 *
 * For each component:
 * 1. Gets path-filtered commits since the last component-specific tag.
 * 2. Determines the bump type from those commits (or uses the override).
 * 3. Bumps all configured package.json version fields.
 * 4. Generates changelogs via git-cliff with `--include-path` filtering.
 *
 * After all components are processed, runs the optional format command once.
 * Returns a structured `PrepareResult` with all data needed for presentation.
 */
export function releasePrepareMono(config: MonorepoReleaseConfig, options: ReleasePrepareOptions): PrepareResult {
  const { dryRun, force, bumpOverride } = options;
  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };
  const tags: string[] = [];
  const modifiedFiles: string[] = [];
  const components: ComponentPrepareResult[] = [];

  for (const component of config.components) {
    const name = component.dir;

    // 1. Get path-filtered commits since last tag
    const { tag, commits } = getCommitsSinceTarget(component.tagPrefix, component.paths);
    const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

    // Skip components with no changes unless --force is set.
    if (commits.length === 0 && !force) {
      components.push({
        name,
        status: 'skipped',
        previousTag: tag,
        commitCount: 0,
        bumpedFiles: [],
        changelogFiles: [],
        skipReason: `No changes for ${name} ${since}. Skipping.`,
      });
      continue;
    }

    // 2. Determine bump type
    let releaseType: ReleaseType | undefined;
    let parsedCommitCount: number | undefined;

    if (bumpOverride === undefined) {
      const parsedCommits = commits
        .map((c) => parseCommitMessage(c.message, c.hash, workTypes, config.workspaceAliases))
        .filter((c): c is ParsedCommit => c !== undefined);

      parsedCommitCount = parsedCommits.length;
      releaseType = determineBumpType(parsedCommits, workTypes, versionPatterns);
    } else {
      releaseType = bumpOverride;
    }

    if (releaseType === undefined) {
      components.push({
        name,
        status: 'skipped',
        previousTag: tag,
        commitCount: commits.length,
        parsedCommitCount,
        bumpedFiles: [],
        changelogFiles: [],
        skipReason: `No release-worthy changes for ${name} ${since}. Skipping.`,
      });
      continue;
    }

    // 3. Bump all versions for this component
    const bump = bumpAllVersions(component.packageFiles, releaseType, dryRun);
    const newTag = `${component.tagPrefix}${bump.newVersion}`;
    tags.push(newTag);
    modifiedFiles.push(...component.packageFiles, ...component.changelogPaths.map((p) => `${p}/CHANGELOG.md`));

    // 4. Generate changelogs for each configured path with include-path filtering
    const changelogFiles: string[] = [];
    for (const changelogPath of component.changelogPaths) {
      changelogFiles.push(
        ...generateChangelog(config, changelogPath, newTag, dryRun, { includePaths: component.paths }),
      );
    }

    components.push({
      name,
      status: 'released',
      previousTag: tag,
      commitCount: commits.length,
      parsedCommitCount,
      releaseType,
      currentVersion: bump.currentVersion,
      newVersion: bump.newVersion,
      tag: newTag,
      bumpedFiles: bump.files,
      changelogFiles,
    });
  }

  // 5. Run format command once after all components are processed, appending modified file paths
  const formatCommandStr = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);
  let formatCommand: PrepareResult['formatCommand'];

  if (tags.length > 0 && formatCommandStr !== undefined) {
    const fullCommand = `${formatCommandStr} ${modifiedFiles.join(' ')}`;

    if (dryRun) {
      formatCommand = { command: fullCommand, executed: false, files: modifiedFiles };
    } else {
      try {
        execSync(fullCommand, { stdio: 'inherit' });
      } catch (error: unknown) {
        throw new Error(
          `Format command failed ('${fullCommand}'): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      formatCommand = { command: fullCommand, executed: true, files: modifiedFiles };
    }
  }

  return {
    components,
    tags,
    formatCommand,
    dryRun,
  };
}
