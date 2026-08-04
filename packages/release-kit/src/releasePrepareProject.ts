import { join as joinPath } from 'node:path';

import { buildChangelogEntries } from './buildChangelogEntries.ts';
import { buildEmptyReleaseEntry } from './buildEmptyReleaseEntry.ts';
import { planVersionBump } from './planVersionBump.ts';
import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from './changelogJsonFile.ts';
import { applyChangelogOverrides } from './changelogOverrides.ts';
import { createPolicyViolationCollector } from './collectPolicyViolations.ts';
import { decideRelease } from './decideRelease.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { buildTagPattern } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import type { PlannedWrite } from './releasePlan.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import { renderChangelogMarkdown } from './renderChangelogMarkdown.ts';
import { deriveSectionOrder } from './resolveReleaseNotesConfig.ts';
import type {
  ChangelogEntry,
  ChangelogOverride,
  MonorepoReleaseConfig,
  ProjectPrepareResult,
  SkippedProjectResult,
} from './types.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';

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
  /** Mutated in-place to append every file this stage intends to write. */
  writes: PlannedWrite[];
  /** Mutated in-place to append the project tag. */
  tags: string[];
  /**
   * Mutated in-place to surface warnings this stage raises that are not override-specific
   * (currently the release-notes previews' skip reasons). Defaults to a discardable sink.
   */
  warnings?: string[];
  /**
   * Root-tier editorial overrides loaded once at the top of the prepare run. Defaults to an
   * empty map when omitted (no overrides applied). The project changelog applies only the
   * root-tier file — per-workspace files describe per-workspace editorial intent and have no
   * meaning at the aggregated project tier.
   */
  rootOverrides?: Map<string, ChangelogOverride>;
  /**
   * Mutated in-place to surface override warnings (currently empty by design — stale-key
   * warnings are emitted by the orchestrator after aggregating across batches). Defaults to
   * a discardable sink when omitted.
   */
  overrideWarnings?: string[];
  /**
   * Mutated in-place: every root-tier override key matched in this stage is added so the
   * orchestrator can dedupe stale-key warnings across the run. Defaults to a discardable
   * sink when omitted.
   */
  globalMatchedRootKeys?: Set<string>;
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
  const { config, options, modifiedFiles, writes, tags } = args;
  const { rootOverrides, overrideWarnings, globalMatchedRootKeys, warnings } = resolveOptionalOverrideArgs(args);
  const { bumpOverride, withReleaseNotes, force } = options;
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

  // 4/5. Plan the root package.json bump.
  const bump = planVersionBump([ROOT_PACKAGE_FILE], releaseType);
  writes.push(...bump.writes);

  // 6. Compose the project tag.
  const newTag = `${project.tagPrefix}${bump.newVersion}`;

  // 7/8. Plan the root CHANGELOG and (optionally) changelog.json via the routing helper.
  //      When `commits.length === 0` (forced empty-range project release) the helper bypasses
  //      git-cliff in favor of the synthetic "Forced version bump." entry — issue #369.
  const changelogs = planProjectChangelogs({
    config,
    project,
    commits,
    contributingPaths,
    newTag,
    newVersion: bump.newVersion,
    rootOverrides,
    overrideWarnings,
    globalMatchedRootKeys,
  });
  const { changelogFiles, changelogJsonFiles } = changelogs;
  writes.push(...changelogs.writes);

  // 9. Optional release-notes previews under root docs/, rendered from the entries this stage
  // plans to write rather than from the file it has not written yet.
  if (withReleaseNotes === true && config.changelogJson.enabled && changelogJsonFiles.length > 0) {
    const previews = planReleaseNotesPreviews({
      workspacePath: ROOT_CHANGELOG_PATH,
      tag: newTag,
      entries: changelogs.entries,
      sectionOrder: deriveSectionOrder(workTypes),
    });
    writes.push(...previews.writes);
    warnings.push(...previews.warnings);
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
    bumpedFiles: bump.writes.map((write) => write.path),
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

/**
 * Resolve the optional override-related fields on `ReleasePrepareProjectArgs` to concrete
 * defaults. Hoisted from the main function body so its branch count does not push
 * `releasePrepareProject` past the project's complexity ceiling.
 */
function resolveOptionalOverrideArgs(args: ReleasePrepareProjectArgs): {
  rootOverrides: Map<string, ChangelogOverride>;
  overrideWarnings: string[];
  globalMatchedRootKeys: Set<string>;
  warnings: string[];
} {
  return {
    rootOverrides: args.rootOverrides ?? new Map<string, ChangelogOverride>(),
    overrideWarnings: args.overrideWarnings ?? [],
    globalMatchedRootKeys: args.globalMatchedRootKeys ?? new Set<string>(),
    warnings: args.warnings ?? [],
  };
}

/** Inputs to {@link planProjectChangelogs}. */
interface PlanProjectChangelogsArgs {
  config: MonorepoReleaseConfig;
  project: NonNullable<MonorepoReleaseConfig['project']>;
  commits: ReadonlyArray<unknown>;
  contributingPaths: string[];
  newTag: string;
  newVersion: string;
  rootOverrides: Map<string, ChangelogOverride>;
  overrideWarnings: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Builds the project's new entries (cliff or synthetic empty-range), applies editorial
 * overrides, and renders `changelog.json` and `CHANGELOG.md` from the resulting set.
 *
 * The cliff path renders a fresh overwrite because git-cliff returns the FULL release history in
 * `--context` mode and the project changelog is regenerated in full each run. The empty-range
 * path merges with what is on disk so prior synthetic entries are preserved.
 *
 * Returns the rendered writes alongside the entry set they carry, so the caller can render the
 * release-notes previews from the same entries rather than re-reading the file.
 */
function planProjectChangelogs(args: PlanProjectChangelogsArgs): {
  changelogFiles: string[];
  changelogJsonFiles: string[];
  entries: ChangelogEntry[];
  writes: PlannedWrite[];
} {
  const {
    config,
    project,
    commits,
    contributingPaths,
    newTag,
    newVersion,
    rootOverrides,
    overrideWarnings,
    globalMatchedRootKeys,
  } = args;
  const isEmptyRange = commits.length === 0;
  const today = new Date().toISOString().slice(0, 10);
  const tagPattern = buildTagPattern([project.tagPrefix]);

  const newEntries: ChangelogEntry[] = isEmptyRange
    ? [buildEmptyReleaseEntry(newVersion, today)]
    : buildChangelogEntries(config, newTag, { tagPattern, includePaths: contributingPaths });

  const applied = applyChangelogOverrides(newEntries, rootOverrides);
  if (applied.errors.length > 0) {
    throw new Error(`Changelog override application failed:\n  - ${applied.errors.join('\n  - ')}`);
  }
  overrideWarnings.push(...applied.warnings);
  // Project changelog applies only the root tier, so every matched key here is by
  // definition root-sourced.
  for (const matched of applied.matchedKeys) {
    globalMatchedRootKeys.add(matched);
  }

  const changelogJsonPath = resolveChangelogJsonPath(config, ROOT_CHANGELOG_PATH);
  const sectionOrder = deriveSectionOrder(config.workTypes ?? { ...DEFAULT_WORK_TYPES });

  // For the cliff path, render fresh (cliff returns full history). For empty-range, merge
  // with disk to preserve prior synthetic entries.
  const renderEntries: ChangelogEntry[] = isEmptyRange
    ? mergeChangelogEntriesWithDisk(changelogJsonPath, applied.entries)
    : applied.entries;

  const writes: PlannedWrite[] = [];
  const changelogJsonFiles: string[] = [];
  if (config.changelogJson.enabled) {
    writes.push({ path: changelogJsonPath, content: renderChangelogJson(renderEntries) });
    changelogJsonFiles.push(changelogJsonPath);
  }

  const changelogFile = joinPath(ROOT_CHANGELOG_PATH, 'CHANGELOG.md');
  writes.push({ path: changelogFile, content: renderChangelogMarkdown(renderEntries, { sectionOrder }) });

  return { changelogFiles: [changelogFile], changelogJsonFiles, entries: renderEntries, writes };
}
