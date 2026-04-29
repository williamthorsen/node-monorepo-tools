import { bumpAllVersions } from './bumpAllVersions.ts';
import { decideRelease } from './decideRelease.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { generateChangelogJson } from './generateChangelogJson.ts';
import { buildTagPattern, generateChangelog } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import { deriveSectionOrder } from './resolveReleaseNotesConfig.ts';
import type { MonorepoReleaseConfig, ProjectPrepareResult } from './types.ts';
import { writeReleaseNotesPreviews } from './writeReleaseNotesPreviews.ts';

/** File path for the root `package.json` bumped during the project release stage. */
const ROOT_PACKAGE_FILE = './package.json';

/** Path argument passed to `generateChangelog`/`generateChangelogJson`; resolves to root paths at runtime. */
const ROOT_CHANGELOG_PATH = '.';

/** Inputs to the project-release stage. */
export interface ReleasePrepareProjectArgs {
  /** Resolved monorepo config; `config.project` must be defined when this function is called. */
  config: MonorepoReleaseConfig;
  options: ReleasePrepareOptions;
  /** Mutated in-place to append project-level files (root package.json, root CHANGELOG.md, root changelog.json). */
  modifiedFiles: string[];
  /** Mutated in-place to append the project tag. */
  tags: string[];
}

/**
 * Run the project-level release stage.
 *
 * Mirrors the per-workspace pipeline shape — find baseline tag → derive bump → bump version →
 * regenerate CHANGELOG → optionally emit changelog.json and release-notes previews — but
 * targets the root `package.json` and the root `CHANGELOG.md`. Contributing paths are the
 * union of every (already-filtered) workspace's `paths`.
 *
 * Returns a structured `{ status: 'skipped', skipReason, ... }` result when neither
 * commits nor `--force` provide a release signal. The caller should attach the returned
 * result to `PrepareResult.project`. `undefined` is returned only when there is no
 * configured `project` block — handled at the call site, not here.
 *
 * Caller contract: `prepareCommand` rejects `--only` upstream when a project block is
 * configured, so this orchestrator never has to reason about workspace-narrowing flags.
 */
export function releasePrepareProject(args: ReleasePrepareProjectArgs): ProjectPrepareResult {
  const { config, options, modifiedFiles, tags } = args;
  const { dryRun, bumpOverride, withReleaseNotes, force } = options;
  const project = config.project;
  if (project === undefined) {
    throw new Error('releasePrepareProject called without a configured project block');
  }

  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };

  // 1. Compute contributing paths (union of every non-excluded workspace's paths).
  const contributingPaths = config.workspaces.flatMap((workspace) => workspace.paths);

  // 2. Find the most recent project tag and the commits since it under contributing paths.
  const { tag, commits } = getCommitsSinceTarget([project.tagPrefix], contributingPaths);
  const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

  // 3. Apply the unified release-decision algorithm. `--bump=X` is purely a level chooser;
  //    `--force` is purely a release trigger that defaults to patch when no level is given.
  const decision = decideRelease({
    commits,
    force,
    bumpOverride,
    workTypes,
    versionPatterns,
    scopeAliases: config.scopeAliases,
    skipReasons: {
      noCommits: `No commits ${since}. Pass --force to release at patch. Skipping.`,
      noBumpWorthy: `No bump-worthy commits ${since}. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.`,
    },
  });

  if (decision.outcome === 'skip') {
    return {
      status: 'skipped',
      previousTag: tag,
      commitCount: commits.length,
      parsedCommitCount: decision.parsedCommitCount,
      bumpedFiles: [],
      changelogFiles: [],
      unparseableCommits: decision.unparseableCommits,
      skipReason: decision.skipReason,
    };
  }

  const { releaseType, parsedCommitCount, unparseableCommits } = decision;

  // 4/5. Bump root package.json (handles dry-run internally).
  const bump = bumpAllVersions([ROOT_PACKAGE_FILE], releaseType, dryRun);

  // 6. Compose the project tag.
  const newTag = `${project.tagPrefix}${bump.newVersion}`;

  // 7. Generate the root CHANGELOG via git-cliff, filtered to project tags only.
  const tagPattern = buildTagPattern([project.tagPrefix]);
  const changelogFiles = generateChangelog(config, ROOT_CHANGELOG_PATH, newTag, dryRun, {
    tagPattern,
    includePaths: contributingPaths,
  });

  // 8. Emit the root changelog.json when enabled.
  let changelogJsonFiles: string[] = [];
  if (config.changelogJson.enabled) {
    changelogJsonFiles = generateChangelogJson(config, ROOT_CHANGELOG_PATH, newTag, dryRun, {
      tagPattern,
      includePaths: contributingPaths,
    });
  }

  // 9. Optional release-notes previews under root docs/.
  const firstChangelogJsonPath = changelogJsonFiles[0];
  if (withReleaseNotes === true && config.changelogJson.enabled && firstChangelogJsonPath !== undefined) {
    const sectionOrder = deriveSectionOrder(workTypes);
    writeReleaseNotesPreviews({
      workspacePath: ROOT_CHANGELOG_PATH,
      tag: newTag,
      changelogJsonPath: firstChangelogJsonPath,
      sectionOrder,
      dryRun,
    });
  }

  // 10. Append the project tag and modified files to the shared aggregators so downstream
  // commands (`commit`, `tag`, format command) see them alongside per-workspace artifacts.
  tags.push(newTag);
  modifiedFiles.push(ROOT_PACKAGE_FILE, ...changelogFiles, ...changelogJsonFiles);

  // 11. Build and return the result.
  const result: ProjectPrepareResult = {
    status: 'released',
    commitCount: commits.length,
    parsedCommitCount,
    releaseType,
    currentVersion: bump.currentVersion,
    newVersion: bump.newVersion,
    tag: newTag,
    bumpedFiles: bump.files,
    changelogFiles,
    commits,
  };
  if (tag !== undefined) {
    result.previousTag = tag;
  }
  if (unparseableCommits !== undefined) {
    result.unparseableCommits = unparseableCommits;
  }
  if (bumpOverride !== undefined) {
    result.bumpOverride = bumpOverride;
  }
  return result;
}
