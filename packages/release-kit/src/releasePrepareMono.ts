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
  Commit,
  ComponentPrepareResult,
  MonorepoReleaseConfig,
  ParsedCommit,
  PrepareResult,
  ReleaseType,
  VersionPatterns,
  WorkTypeConfig,
} from './types.ts';

interface BumpDetermination {
  releaseType: ReleaseType | undefined;
  parsedCommitCount: number;
  unparseableCommits: Commit[] | undefined;
}

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
    let unparseableCommits: Commit[] | undefined;

    if (bumpOverride === undefined) {
      const determination = determineBumpFromCommits(commits, workTypes, versionPatterns, config.workspaceAliases);
      parsedCommitCount = determination.parsedCommitCount;
      unparseableCommits = determination.unparseableCommits;
      releaseType = determination.releaseType;
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
        unparseableCommits,
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
      unparseableCommits,
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

/** Parse commits, determine bump type, and apply patch floor when commits exist but none parsed. */
function determineBumpFromCommits(
  commits: Commit[],
  workTypes: Record<string, WorkTypeConfig>,
  versionPatterns: VersionPatterns,
  workspaceAliases: Record<string, string> | undefined,
): BumpDetermination {
  const parsedCommits: ParsedCommit[] = [];
  const unparseable: Commit[] = [];

  for (const commit of commits) {
    const parsed = parseCommitMessage(commit.message, commit.hash, workTypes, workspaceAliases);
    if (parsed === undefined) {
      unparseable.push(commit);
    } else {
      parsedCommits.push(parsed);
    }
  }

  let releaseType = determineBumpType(parsedCommits, workTypes, versionPatterns);

  // Apply patch floor: commits exist but none determined a bump type
  if (releaseType === undefined && commits.length > 0) {
    releaseType = 'patch';
  }

  return {
    releaseType,
    parsedCommitCount: parsedCommits.length,
    unparseableCommits: unparseable.length > 0 ? unparseable : undefined,
  };
}
