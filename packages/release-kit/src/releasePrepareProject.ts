import { join as joinPath } from 'node:path';

import { attachChangelogDiagnostics } from './attachChangelogDiagnostics.ts';
import { readReleaseHistory, type ReleaseHistory, toReleaseEntries } from './buildChangelogEntries.ts';
import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from './changelogJsonFile.ts';
import { applyChangelogOverrides } from './changelogOverrides.ts';
import { decideRelease } from './decideRelease.ts';
import { DEFAULT_WORK_TYPES } from './defaults.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump } from './planVersionBump.ts';
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

/** File path for the root `package.json` bumped during the project release stage. */
const ROOT_PACKAGE_FILE = './package.json';

/** Root changelog directory, passed to `resolveChangelogJsonPath` and joined with `CHANGELOG.md`. */
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
 * Mirrors the per-workspace pipeline shape — read the history → decide the bump → bump version →
 * regenerate CHANGELOG → optionally emit changelog.json and release-notes previews — but
 * targets the root `package.json` and the root `CHANGELOG.md`. Contributing paths come from
 * the resolved `project.paths`, which defaults to the union of every (already-filtered)
 * workspace's `paths`.
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

  // 1. Read the project's history once under its contributing paths, resolved at config load.
  const history = readReleaseHistory(config, { tagPrefixes: [project.tagPrefix], paths: project.paths });
  const { commits, diagnostics, parsedCommitCount, unparseableCommits } = history.unreleased;
  const tag = history.previousTag;
  const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

  // 2. Decide the release. `--bump=X` is purely a level chooser; `--force` is purely a release
  //    trigger that defaults to patch when no level is given.
  const decision = decideRelease({
    naturalBump: history.unreleased.bump,
    commitCount: commits.length,
    force,
    bumpOverride,
    skipReasons: {
      noCommits: `No commits ${since}. Pass --force to release at patch. Skipping.`,
      noBumpWorthy: `No bump-worthy commits ${since}. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.`,
    },
  });

  if (decision.outcome === 'skip') {
    const skipped: SkippedProjectResult = {
      status: 'skipped',
      commitCount: commits.length,
      parsedCommitCount,
      skipReason: decision.skipReason,
    };
    if (tag !== undefined) {
      skipped.previousTag = tag;
    }
    if (unparseableCommits !== undefined) {
      skipped.unparseableCommits = unparseableCommits;
    }
    attachChangelogDiagnostics(skipped, diagnostics);
    return skipped;
  }

  const { releaseType } = decision;

  // 3. Plan the root package.json bump.
  const bump = planVersionBump([ROOT_PACKAGE_FILE], releaseType);
  writes.push(...bump.writes);

  // 4. Compose the project tag.
  const newTag = `${project.tagPrefix}${bump.newVersion}`;

  // 5. Plan the root CHANGELOG and (optionally) changelog.json. When the window yields no changelog item (a forced
  //    project release), the planner records the synthetic "Forced version bump." entry for the new version.
  const changelogs = planProjectChangelogs({
    config,
    history,
    newTag,
    rootOverrides,
    overrideWarnings,
    globalMatchedRootKeys,
  });
  const { changelogFiles, changelogJsonFiles } = changelogs;
  writes.push(...changelogs.writes);

  // 6. Optional release-notes previews under root docs/, rendered from the entries this stage
  // plans to write rather than from the file it has not written yet.
  const previewFiles: string[] = [];
  if (withReleaseNotes === true && config.changelogJson.enabled && changelogJsonFiles.length > 0) {
    const previews = planReleaseNotesPreviews({
      workspacePath: ROOT_CHANGELOG_PATH,
      tag: newTag,
      entries: changelogs.entries,
      sectionOrder: deriveSectionOrder(workTypes),
    });
    writes.push(...previews.writes);
    warnings.push(...previews.warnings);
    previewFiles.push(...previews.writes.map((write) => write.path));
  }

  // 7. Append the project tag and modified files to the shared aggregators so downstream
  // commands (`commit`, `tag`, format command) see them alongside per-workspace artifacts.
  tags.push(newTag);
  modifiedFiles.push(ROOT_PACKAGE_FILE, ...changelogFiles, ...changelogJsonFiles);

  // 8. Build and return the result.
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
  if (previewFiles.length > 0) {
    result.previewFiles = previewFiles;
  }
  if (tag !== undefined) {
    result.previousTag = tag;
  }
  if (unparseableCommits !== undefined) {
    result.unparseableCommits = unparseableCommits;
  }
  if (bumpOverride !== undefined) {
    result.bumpOverride = bumpOverride;
  }
  attachChangelogDiagnostics(result, diagnostics);
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
  history: ReleaseHistory;
  newTag: string;
  rootOverrides: Map<string, ChangelogOverride>;
  overrideWarnings: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Builds the project's new entries (release windows, or the synthetic entry when the unreleased window yields no
 * item), applies editorial overrides, merges them with the `changelog.json` on disk, and renders `changelog.json` and
 * `CHANGELOG.md` from the merged set. The merge keeps the synthetic entries of earlier releases, which the release
 * windows do not yield.
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
  const { config, history, newTag, rootOverrides, overrideWarnings, globalMatchedRootKeys } = args;
  const today = new Date().toISOString().slice(0, 10);

  const builtEntries = toReleaseEntries(history, newTag, today);

  const applied = applyChangelogOverrides(builtEntries, rootOverrides);
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

  const renderEntries = mergeChangelogEntriesWithDisk(changelogJsonPath, applied.entries);

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
