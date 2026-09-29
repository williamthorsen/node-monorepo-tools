import { join as joinPath } from 'node:path';

import { assertTaggedBaseline, findUntaggedBaseline } from './assertTaggedBaseline.ts';
import { attachChangelogDiagnostics } from './attachChangelogDiagnostics.ts';
import { readReleaseHistory, type ReleaseHistory, toReleaseEntries } from './buildChangelogEntries.ts';
import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from './changelogJsonFile.ts';
import { applyChangelogOverrides } from './changelogOverrides.ts';
import { decideRelease } from './decideRelease.ts';
import { DEFAULT_WORK_TYPES } from './defaults.ts';
import { deriveSectionOrder } from './deriveReleaseNotesConfig.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump } from './planVersionBump.ts';
import { planPreservedSections } from './readChangelogSections.ts';
import type { PlannedWrite } from './releasePlan.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import { renderChangelogMarkdown } from './renderChangelogMarkdown.ts';
import type {
  ChangelogEntry,
  ChangelogOverride,
  ChangelogPreservation,
  MonorepoPrepareConfig,
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
  config: MonorepoPrepareConfig;
  options: ReleasePrepareOptions;
  /** Mutated in-place to append project-level files (root package.json, root CHANGELOG.md, root changelog.json). */
  modifiedFiles: string[];
  /** Mutated in-place to append every file that this stage intends to write. */
  writes: PlannedWrite[];
  /** Mutated in-place to append the project tag. */
  tags: string[];
  /**
   * Mutated in-place to receive the warnings that this stage raises and that are not override-specific.
   * Defaults to a discardable sink.
   */
  warnings?: string[];
  /**
   * Root-tier editorial overrides. Defaults to an empty map. The project changelog applies only the
   * root-tier file: Per-workspace files describe per-workspace editorial intent and are
   * meaningless at the aggregated project tier.
   */
  rootOverrides?: Map<string, ChangelogOverride>;
  /**
   * Mutated in-place to receive override-application warnings. Stale-key warnings are not among them: Those
   * depend on the matches of every batch, which `globalMatchedRootKeys` collects. Defaults to a discardable sink.
   */
  overrideWarnings?: string[];
  /**
   * Mutated in-place to receive every root-tier override key that this stage matches, so that stale-key
   * warnings can cover the whole run. Defaults to a discardable sink.
   */
  globalMatchedRootKeys?: Set<string>;
}

/**
 * Runs the project-level release stage: reads the history, decides the bump, and plans the root `package.json`
 * bump, the root `CHANGELOG.md`, and optionally `changelog.json` and release-notes previews. Contributing paths
 * come from the resolved `project.paths`, which defaults to the union of every (already-filtered) workspace's
 * `paths`.
 *
 * Returns a `skipped` result when neither commits nor `--force` provide a release signal, and throws when
 * `config.project` is undefined. A run narrowed by `--only` does not reach this stage, so it doesn't
 * read any narrowing flag.
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
  assertTaggedBaseline([
    findUntaggedBaseline(
      {
        label: 'project',
        packageFiles: [ROOT_PACKAGE_FILE],
        changelogPaths: [ROOT_CHANGELOG_PATH],
        tagPrefixes: [project.tagPrefix],
        previousTag: history.previousTag,
      },
      config,
    ),
  ]);
  const { commits, diagnostics, parsedCommitCount, unparseableCommits } = history.unreleased;
  const tag = history.previousTag;
  const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

  // 2. Decide the release. `--bump=X` is purely a level chooser; `--force` is purely a release
  //    trigger that defaults to patch when `--bump` is absent.
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

  // 5. Plan the root CHANGELOG and (optionally) changelog.json. When the window doesn't yield any changelog item (a
  //    forced project release), the planner records the synthetic "Forced version bump." entry for the new version.
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

  // 6. Plan the optional release-notes previews under root docs/ from the planned entries, since the changelog
  // file is not yet written.
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

  // 7. Append the project tag and modified files to the shared aggregators, so that the plan's tags and format
  // command include them alongside the per-workspace ones.
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
  if (changelogs.changelogPreservation.length > 0) {
    result.changelogPreservation = changelogs.changelogPreservation;
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

/** Resolves the optional override-related fields on `ReleasePrepareProjectArgs` to concrete defaults. */
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
  config: MonorepoPrepareConfig;
  history: ReleaseHistory;
  newTag: string;
  rootOverrides: Map<string, ChangelogOverride>;
  overrideWarnings: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Builds the project's new entries (release windows, or the synthetic entry when the unreleased window doesn't yield
 * any item), applies editorial overrides, merges them with the `changelog.json` on disk, and renders `changelog.json`
 * and `CHANGELOG.md` from the merged set. The merge keeps the synthetic entries of earlier releases, which the release
 * windows do not yield, and `CHANGELOG.md` also keeps the existing sections whose versions the merged set lacks.
 *
 * Returns the rendered writes alongside the entries from which they were rendered, so that the caller can render
 * the release-notes previews from the same entries.
 */
function planProjectChangelogs(args: PlanProjectChangelogsArgs): {
  changelogFiles: string[];
  changelogJsonFiles: string[];
  changelogPreservation: ChangelogPreservation[];
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
  const preserved = planPreservedSections(changelogFile, renderEntries);
  writes.push({
    path: changelogFile,
    content: renderChangelogMarkdown(renderEntries, { sectionOrder, preservedSections: preserved.sections }),
  });

  return {
    changelogFiles: [changelogFile],
    changelogJsonFiles,
    changelogPreservation: preserved.preservation === undefined ? [] : [preserved.preservation],
    entries: renderEntries,
    writes,
  };
}
