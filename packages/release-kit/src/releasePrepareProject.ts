import { buildChangelogEntries } from './buildChangelogEntries.ts';
import { buildEmptyReleaseEntry } from './buildEmptyReleaseEntry.ts';
import { bumpAllVersions } from './bumpAllVersions.ts';
import { resolveChangelogJsonPath, writeChangelogJson } from './changelogJsonFile.ts';
import { createPolicyViolationCollector } from './collectPolicyViolations.ts';
import { decideRelease } from './decideRelease.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { buildTagPattern, generateChangelog } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import { deriveSectionOrder } from './resolveReleaseNotesConfig.ts';
import type { MonorepoReleaseConfig, ProjectPrepareResult, SkippedProjectResult } from './types.ts';
import { writeEmptyReleaseChangelog } from './writeEmptyReleaseChangelog.ts';
import { writeReleaseNotesPreviews } from './writeReleaseNotesPreviews.ts';

/** File path for the root `package.json` bumped during the project release stage. */
const ROOT_PACKAGE_FILE = './package.json';

/** Path argument passed to `generateChangelog` and `resolveChangelogJsonPath`; resolves to root paths at runtime. */
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
  const breakingPolicies = config.breakingPolicies ?? DEFAULT_BREAKING_POLICIES;

  // 1. Compute contributing paths (union of every non-excluded workspace's paths).
  const contributingPaths = config.workspaces.flatMap((workspace) => workspace.paths);

  // 2. Find the most recent project tag and the commits since it under contributing paths.
  const { tag, commits } = getCommitsSinceTarget([project.tagPrefix], contributingPaths);
  const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

  // 3. Apply the unified release-decision algorithm. `--bump=X` is purely a level chooser;
  //    `--force` is purely a release trigger that defaults to patch when no level is given.
  const collector = createPolicyViolationCollector();
  const decision = decideRelease({
    commits,
    force,
    bumpOverride,
    workTypes,
    versionPatterns,
    scopeAliases: config.scopeAliases,
    breakingPolicies,
    onPolicyViolation: collector.onPolicyViolation,
    skipReasons: {
      noCommits: `No commits ${since}. Pass --force to release at patch. Skipping.`,
      noBumpWorthy: `No bump-worthy commits ${since}. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.`,
    },
  });

  const policyViolations = collector.violations.length > 0 ? collector.violations : undefined;

  if (decision.outcome === 'skip') {
    const skipped: SkippedProjectResult = {
      status: 'skipped',
      commitCount: commits.length,
      parsedCommitCount: decision.parsedCommitCount,
      skipReason: decision.skipReason,
    };
    if (tag !== undefined) {
      skipped.previousTag = tag;
    }
    if (decision.unparseableCommits !== undefined) {
      skipped.unparseableCommits = decision.unparseableCommits;
    }
    if (policyViolations !== undefined) {
      skipped.policyViolations = policyViolations;
    }
    return skipped;
  }

  const { releaseType, parsedCommitCount, unparseableCommits } = decision;

  // 4/5. Bump root package.json (handles dry-run internally).
  const bump = bumpAllVersions([ROOT_PACKAGE_FILE], releaseType, dryRun);

  // 6. Compose the project tag.
  const newTag = `${project.tagPrefix}${bump.newVersion}`;

  // 7/8. Generate the root CHANGELOG and (optionally) changelog.json via the routing helper.
  //      When `commits.length === 0` (forced empty-range project release) the helper bypasses
  //      git-cliff in favor of the synthetic "Forced version bump." entry — issue #369.
  const { changelogFiles, changelogJsonFiles } = writeProjectChangelogs({
    config,
    project,
    commits,
    contributingPaths,
    newTag,
    newVersion: bump.newVersion,
    dryRun,
  });

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
  if (policyViolations !== undefined) {
    result.policyViolations = policyViolations;
  }
  if (bumpOverride !== undefined) {
    result.bumpOverride = bumpOverride;
  }
  return result;
}

/** Inputs to {@link writeProjectChangelogs}. */
interface WriteProjectChangelogsArgs {
  config: MonorepoReleaseConfig;
  project: NonNullable<MonorepoReleaseConfig['project']>;
  commits: ReadonlyArray<unknown>;
  contributingPaths: string[];
  newTag: string;
  newVersion: string;
  dryRun: boolean;
}

/**
 * Route between the empty-range synthetic path and the cliff path for the project stage's
 * root `CHANGELOG.md` and (optional) root `changelog.json`. Project stage uses
 * `writeChangelogJson` (fresh write, no merge) on both branches — symmetric with the
 * existing non-empty-range behavior. Pulls the routing logic out of `releasePrepareProject`
 * so the host stays under the project's cyclomatic-complexity ceiling.
 */
function writeProjectChangelogs(args: WriteProjectChangelogsArgs): {
  changelogFiles: string[];
  changelogJsonFiles: string[];
} {
  const { config, project, commits, contributingPaths, newTag, newVersion, dryRun } = args;
  const isEmptyRange = commits.length === 0;
  const today = new Date().toISOString().slice(0, 10);
  const tagPattern = buildTagPattern([project.tagPrefix]);

  const changelogFiles = isEmptyRange
    ? [writeEmptyReleaseChangelog({ changelogPath: ROOT_CHANGELOG_PATH, newVersion, date: today, dryRun })]
    : generateChangelog(config, ROOT_CHANGELOG_PATH, newTag, dryRun, {
        tagPattern,
        includePaths: contributingPaths,
      });

  const changelogJsonFiles: string[] = [];
  if (config.changelogJson.enabled) {
    const changelogJsonPath = resolveChangelogJsonPath(config, ROOT_CHANGELOG_PATH);
    const entries = isEmptyRange
      ? [buildEmptyReleaseEntry(newVersion, today)]
      : buildChangelogEntries(config, newTag, {
          tagPattern,
          includePaths: contributingPaths,
        });
    if (!dryRun) {
      writeChangelogJson(changelogJsonPath, entries);
    }
    changelogJsonFiles.push(changelogJsonPath);
  }

  return { changelogFiles, changelogJsonFiles };
}
