import { execSync } from 'node:child_process';

import type { DependencyGraph } from './buildDependencyGraph.ts';
import { buildDependencyGraph } from './buildDependencyGraph.ts';
import { bumpAllVersions, setAllVersions } from './bumpAllVersions.ts';
import { isForwardVersion } from './compareVersions.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { detectUndeclaredTagPrefixes } from './detectUndeclaredTagPrefixes.ts';
import { determineBumpFromCommits } from './determineBumpFromCommits.ts';
import { generateChangelogJson, generateSyntheticChangelogJson } from './generateChangelogJson.ts';
import { buildTagPattern, generateChangelog } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import type { CurrentVersions, ReleaseEntry } from './propagateBumps.ts';
import { propagateBumps } from './propagateBumps.ts';
import { readCurrentVersion } from './readCurrentVersion.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import type {
  Commit,
  MonorepoReleaseConfig,
  PrepareResult,
  ReleaseType,
  WorkspaceConfig,
  WorkspacePrepareResult,
} from './types.ts';
import { writeSyntheticChangelog } from './writeSyntheticChangelog.ts';

/** Intermediate result from Phase 1 (determine direct bumps). */
interface DirectBumpResult {
  workspace: WorkspaceConfig;
  tag: string | undefined;
  commits: Commit[];
  /** Release type determined from commits (or the override). Undefined when `setVersion` is used. */
  releaseType: ReleaseType | undefined;
  parsedCommitCount: number | undefined;
  unparseableCommits: Commit[] | undefined;
  /** Explicit version from `--set-version`, present only for the overridden workspace. */
  setVersion?: string;
}

/** Intermediate result for a skipped workspace. */
interface SkippedResult {
  workspace: WorkspaceConfig;
  tag: string | undefined;
  commitCount: number;
  parsedCommitCount: number | undefined;
  unparseableCommits: Commit[] | undefined;
  skipReason: string;
}

/** Aggregate result from Phase 1 (determine direct bumps). */
interface Phase1Result {
  directBumps: Map<string, ReleaseEntry>;
  directResults: Map<string, DirectBumpResult>;
  skippedResults: SkippedResult[];
  currentVersions: CurrentVersions;
}

/**
 * Orchestrate release preparation for a monorepo with multiple workspaces.
 *
 * Phase 1: Determine direct bumps from commits for each workspace.
 * Phase 2: Build the dependency graph and propagate bumps to dependents.
 * Phase 2b: Topologically sort the full release set.
 * Phase 3: Execute bumps and generate changelogs in dependency order.
 */
export function releasePrepareMono(config: MonorepoReleaseConfig, options: ReleasePrepareOptions): PrepareResult {
  const { dryRun } = options;

  // === Phase 1: Determine direct bumps ===
  const { directBumps, directResults, skippedResults, currentVersions } = determineDirectBumps(config, options);

  // Build a lookup of previous tags for all workspaces (needed for propagated ones).
  const previousTags = new Map<string, string | undefined>();
  for (const result of directResults.values()) {
    previousTags.set(result.workspace.dir, result.tag);
  }
  for (const skipped of skippedResults) {
    previousTags.set(skipped.workspace.dir, skipped.tag);
  }

  // === Phase 2: Build graph and propagate bumps ===
  const graph = buildDependencyGraph(config.workspaces);
  const fullReleaseSet = propagateBumps(directBumps, graph, currentVersions);

  // === Phase 2b: Topologically sort the release set ===
  const { sorted: sortedDirs, cyclicDirs } = topologicalSort(fullReleaseSet, graph);
  const warnings: string[] = [];
  if (cyclicDirs.length > 0) {
    warnings.push(
      `Circular workspace dependencies detected among: ${cyclicDirs.join(', ')}. ` +
        'Propagation metadata may be incomplete for these workspaces.',
    );
  }

  // === Phase 3: Execute bumps and generate changelogs ===
  const workspaces = collectSkippedWorkspaces(skippedResults, fullReleaseSet);
  const { tags, modifiedFiles } = executeReleaseSet(
    sortedDirs,
    fullReleaseSet,
    config,
    directResults,
    previousTags,
    dryRun,
    workspaces,
  );

  // Reorder workspaces to match original config order.
  const configOrder = new Map(config.workspaces.map((w, i) => [w.dir, i]));
  workspaces.sort((a, b) => {
    const orderA = configOrder.get(a.name ?? '') ?? 0;
    const orderB = configOrder.get(b.name ?? '') ?? 0;
    return orderA - orderB;
  });

  // === Phase 4: Format ===
  const formatCommand = runFormatCommand(config, tags, modifiedFiles, dryRun);

  return {
    workspaces,
    tags,
    formatCommand,
    dryRun,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** Determine direct bumps from commits for each workspace. */
function determineDirectBumps(config: MonorepoReleaseConfig, options: ReleasePrepareOptions): Phase1Result {
  const { force, bumpOverride, setVersion } = options;

  // Enforce the `--set-version` contract at the orchestration layer. The CLI layer
  // (`prepareCommand`) normally narrows to a single workspace before calling, but this
  // guard protects against programmatic misuse.
  if (setVersion !== undefined && config.workspaces.length !== 1) {
    throw new Error(`--set-version requires exactly one workspace; received ${config.workspaces.length}`);
  }

  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };

  const directBumps = new Map<string, ReleaseEntry>();
  const directResults = new Map<string, DirectBumpResult>();
  const skippedResults: SkippedResult[] = [];
  const currentVersions: CurrentVersions = new Map();
  const hintState: BaselineHintState = { emitted: false };
  // Build once: the union of every workspace's derived and declared tag prefixes. Passed into
  // the baseline hint so sibling workspaces' tags aren't misclassified as undeclared candidates.
  const knownPrefixes = config.workspaces.flatMap(getAllTagPrefixes);

  for (const workspace of config.workspaces) {
    const name = workspace.dir;
    const { tag, commits } = getCommitsSinceTarget(getAllTagPrefixes(workspace), workspace.paths);
    const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

    if (tag === undefined) {
      maybeEmitBaselineHint(workspace, knownPrefixes, hintState);
    }

    // Read current version from the first package file.
    // Important: this read must occur BEFORE any bypass branch so propagation sees the
    // pre-write current version.
    const primaryPackageFile = workspace.packageFiles[0];
    if (primaryPackageFile !== undefined) {
      const currentVersion = readCurrentVersion(primaryPackageFile);
      if (currentVersion !== undefined) {
        currentVersions.set(workspace.dir, currentVersion);
      }
    }

    // --set-version bypass: skip commit-derived bump logic for the overridden workspace.
    // Validation that only one workspace is targeted runs in `prepareCommand` before this function.
    if (setVersion !== undefined) {
      const currentVersion = currentVersions.get(workspace.dir);
      if (currentVersion === undefined) {
        throw new Error(
          `Cannot validate --set-version: failed to read current version from ${primaryPackageFile ?? '(no package file)'}`,
        );
      }
      if (!isForwardVersion(currentVersion, setVersion)) {
        throw new Error(`--set-version ${setVersion} is not greater than current version ${currentVersion}`);
      }

      // The releaseType in the ReleaseEntry is a sentinel value; `newVersionOverride` takes
      // precedence when propagation computes dependent versions.
      directBumps.set(workspace.dir, { releaseType: 'patch', newVersionOverride: setVersion });
      directResults.set(workspace.dir, {
        workspace,
        tag,
        commits,
        releaseType: undefined,
        parsedCommitCount: undefined,
        unparseableCommits: undefined,
        setVersion,
      });
      continue;
    }

    // Skip workspaces with no changes unless --force is set.
    if (commits.length === 0 && !force) {
      skippedResults.push({
        workspace,
        tag,
        commitCount: 0,
        parsedCommitCount: undefined,
        unparseableCommits: undefined,
        skipReason: `No changes for ${name} ${since}. Skipping.`,
      });
      continue;
    }

    // Determine bump type.
    let releaseType: ReleaseType | undefined;
    let parsedCommitCount: number | undefined;
    let unparseableCommits: Commit[] | undefined;

    if (bumpOverride === undefined) {
      const determination = determineBumpFromCommits(commits, workTypes, versionPatterns, config.scopeAliases);
      parsedCommitCount = determination.parsedCommitCount;
      unparseableCommits = determination.unparseableCommits;
      releaseType = determination.releaseType;
    } else {
      releaseType = bumpOverride;
    }

    if (releaseType === undefined) {
      skippedResults.push({
        workspace,
        tag,
        commitCount: commits.length,
        parsedCommitCount,
        unparseableCommits,
        skipReason: `No release-worthy changes for ${name} ${since}. Skipping.`,
      });
      continue;
    }

    directBumps.set(workspace.dir, { releaseType });
    directResults.set(workspace.dir, {
      workspace,
      tag,
      commits,
      releaseType,
      parsedCommitCount,
      unparseableCommits,
    });
  }

  return { directBumps, directResults, skippedResults, currentVersions };
}

/** Collect skipped workspaces, excluding those promoted via propagation. */
function collectSkippedWorkspaces(
  skippedResults: SkippedResult[],
  fullReleaseSet: Map<string, ReleaseEntry>,
): WorkspacePrepareResult[] {
  const workspaces: WorkspacePrepareResult[] = [];
  for (const skipped of skippedResults) {
    if (fullReleaseSet.has(skipped.workspace.dir)) {
      continue;
    }
    workspaces.push({
      name: skipped.workspace.dir,
      status: 'skipped',
      previousTag: skipped.tag,
      commitCount: skipped.commitCount,
      parsedCommitCount: skipped.parsedCommitCount,
      unparseableCommits: skipped.unparseableCommits,
      bumpedFiles: [],
      changelogFiles: [],
      skipReason: skipped.skipReason,
    });
  }
  return workspaces;
}

/** Execute bumps and generate changelogs for each workspace in dependency order. */
function executeReleaseSet(
  sortedDirs: string[],
  fullReleaseSet: Map<string, ReleaseEntry>,
  config: MonorepoReleaseConfig,
  directResults: Map<string, DirectBumpResult>,
  previousTags: Map<string, string | undefined>,
  dryRun: boolean,
  workspaces: WorkspacePrepareResult[],
): { tags: string[]; modifiedFiles: string[] } {
  const tags: string[] = [];
  const modifiedFiles: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const dir of sortedDirs) {
    const releaseEntry = fullReleaseSet.get(dir);
    if (releaseEntry === undefined) {
      continue;
    }

    const workspace = findWorkspace(config.workspaces, dir);
    if (workspace === undefined) {
      continue;
    }

    executeWorkspaceRelease({
      dir,
      workspace,
      releaseEntry,
      directResult: directResults.get(dir),
      previousTags,
      config,
      dryRun,
      today,
      tags,
      modifiedFiles,
      workspaces,
    });
  }

  return { tags, modifiedFiles };
}

/** Arguments for executing a single workspace's bump + changelog generation. */
interface ExecuteWorkspaceReleaseArgs {
  dir: string;
  workspace: WorkspaceConfig;
  releaseEntry: ReleaseEntry;
  directResult: DirectBumpResult | undefined;
  previousTags: Map<string, string | undefined>;
  config: MonorepoReleaseConfig;
  dryRun: boolean;
  today: string;
  tags: string[];
  modifiedFiles: string[];
  workspaces: WorkspacePrepareResult[];
}

/** Bump, generate changelogs, and append the workspace result for one entry in the release set. */
function executeWorkspaceRelease(args: ExecuteWorkspaceReleaseArgs): void {
  const {
    dir,
    workspace,
    releaseEntry,
    directResult,
    previousTags,
    config,
    dryRun,
    today,
    tags,
    modifiedFiles,
    workspaces,
  } = args;

  // Bump all versions for this workspace. For --set-version workspaces, write the explicit
  // version directly; otherwise compute the bump from the release type.
  const setVersionTarget = directResult?.setVersion;
  const bump =
    setVersionTarget === undefined
      ? bumpAllVersions(workspace.packageFiles, releaseEntry.releaseType, dryRun)
      : setAllVersions(workspace.packageFiles, setVersionTarget, dryRun);
  const newTag = `${workspace.tagPrefix}${bump.newVersion}`;
  tags.push(newTag);
  modifiedFiles.push(...workspace.packageFiles, ...workspace.changelogPaths.map((p) => `${p}/CHANGELOG.md`));

  const isPropagationOnly = directResult === undefined;
  const changelogFiles = generateWorkspaceChangelogs({
    workspace,
    releaseEntry,
    newTag,
    newVersion: bump.newVersion,
    isPropagationOnly,
    config,
    dryRun,
    today,
    modifiedFiles,
  });

  workspaces.push({
    name: dir,
    status: 'released',
    previousTag: directResult?.tag ?? previousTags.get(dir),
    commitCount: directResult?.commits.length ?? 0,
    parsedCommitCount: directResult?.parsedCommitCount,
    // For --set-version workspaces releaseType is left undefined so reporting can branch
    // on the override case without conflating it with a bump type.
    releaseType: setVersionTarget === undefined ? releaseEntry.releaseType : undefined,
    currentVersion: bump.currentVersion,
    newVersion: bump.newVersion,
    tag: newTag,
    bumpedFiles: bump.files,
    changelogFiles,
    commits: directResult?.commits,
    unparseableCommits: directResult?.unparseableCommits,
    propagatedFrom: releaseEntry.propagatedFrom,
    ...(setVersionTarget === undefined ? {} : { setVersion: setVersionTarget }),
  });
}

/** Arguments for generating changelog files for a single workspace. */
interface GenerateWorkspaceChangelogsArgs {
  workspace: WorkspaceConfig;
  releaseEntry: ReleaseEntry;
  newTag: string;
  newVersion: string;
  isPropagationOnly: boolean;
  config: MonorepoReleaseConfig;
  dryRun: boolean;
  today: string;
  modifiedFiles: string[];
}

/**
 * Generate changelogs for a workspace: synthetic entries for propagation-only bumps, git-cliff
 * output for direct bumps (including `--set-version`). Returns the list of changelog files written.
 * Additional changelog JSON files are appended to `modifiedFiles` when the feature is enabled.
 */
function generateWorkspaceChangelogs(args: GenerateWorkspaceChangelogsArgs): string[] {
  const { workspace, releaseEntry, newTag, newVersion, isPropagationOnly, config, dryRun, today, modifiedFiles } = args;
  const changelogFiles: string[] = [];

  if (isPropagationOnly && releaseEntry.propagatedFrom !== undefined) {
    for (const changelogPath of workspace.changelogPaths) {
      changelogFiles.push(
        writeSyntheticChangelog({
          changelogPath,
          newVersion,
          date: today,
          propagatedFrom: releaseEntry.propagatedFrom,
          dryRun,
        }),
      );
    }

    if (config.changelogJson.enabled) {
      for (const changelogPath of workspace.changelogPaths) {
        const jsonFiles = generateSyntheticChangelogJson(
          config,
          changelogPath,
          newVersion,
          today,
          releaseEntry.propagatedFrom,
          dryRun,
        );
        modifiedFiles.push(...jsonFiles);
      }
    }
    return changelogFiles;
  }

  const tagPattern = buildTagPattern(getAllTagPrefixes(workspace));
  for (const changelogPath of workspace.changelogPaths) {
    changelogFiles.push(
      ...generateChangelog(config, changelogPath, newTag, dryRun, {
        tagPattern,
        includePaths: workspace.paths,
      }),
    );
  }

  if (config.changelogJson.enabled) {
    for (const changelogPath of workspace.changelogPaths) {
      const jsonFiles = generateChangelogJson(config, changelogPath, newTag, dryRun, {
        tagPattern,
        includePaths: workspace.paths,
      });
      modifiedFiles.push(...jsonFiles);
    }
  }

  return changelogFiles;
}

/** Run the format command on modified files, if configured. */
function runFormatCommand(
  config: MonorepoReleaseConfig,
  tags: string[],
  modifiedFiles: string[],
  dryRun: boolean,
): PrepareResult['formatCommand'] {
  const formatCommandStr = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);

  if (tags.length === 0 || formatCommandStr === undefined) {
    return undefined;
  }

  const fullCommand = `${formatCommandStr} ${modifiedFiles.join(' ')}`;

  if (dryRun) {
    return { command: fullCommand, executed: false, files: modifiedFiles };
  }

  try {
    execSync(fullCommand, { stdio: 'inherit' });
  } catch (error: unknown) {
    throw new Error(
      `Format command failed ('${fullCommand}'): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { command: fullCommand, executed: true, files: modifiedFiles };
}

/** Find a workspace by its `dir` in the workspaces array. */
function findWorkspace(workspaces: readonly WorkspaceConfig[], dir: string): WorkspaceConfig | undefined {
  return workspaces.find((w) => w.dir === dir);
}

/** Shared single-fire flag so multiple no-baseline workspaces trigger at most one hint per run. */
interface BaselineHintState {
  emitted: boolean;
}

/**
 * Emit a one-line hint to stderr pointing at `release-kit show-tag-prefixes` when a workspace
 * has no baseline tag AND the repo contains candidate-shaped tags AND the workspace has no
 * declared `legacyIdentities`.
 *
 * `knownPrefixes` must be the full union across all workspaces so sibling workspaces' tags
 * are not mistaken for undeclared candidates.
 *
 * Prints at most once per prepare run. Does not affect exit code or bump behavior.
 */
function maybeEmitBaselineHint(
  workspace: WorkspaceConfig,
  knownPrefixes: readonly string[],
  state: BaselineHintState,
): void {
  if (state.emitted) return;
  if ((workspace.legacyIdentities?.length ?? 0) > 0) return;

  const candidates = detectUndeclaredTagPrefixes(knownPrefixes);
  if (candidates.length === 0) return;

  const totalTags = candidates.reduce((sum, candidate) => sum + candidate.tagCount, 0);
  const example = candidates[0]?.exampleTags[0] ?? `${candidates[0]?.prefix ?? ''}?`;
  console.error(
    `Hint: no baseline tag found for ${workspace.dir} under '${workspace.tagPrefix}', but ` +
      `${totalTags} candidate-shaped tags exist (e.g., ${example}). ` +
      "Run 'release-kit show-tag-prefixes' to check for undeclared legacy prefixes.",
  );
  state.emitted = true;
}

/**
 * Topologically sort workspace dirs so dependencies are processed before their dependents.
 *
 * Uses Kahn's algorithm. Workspaces not in the release set are excluded. If the graph has
 * cycles, the remaining nodes are appended in arbitrary order and reported via `cyclicDirs`.
 */
function topologicalSort(
  releaseSet: Map<string, ReleaseEntry>,
  graph: DependencyGraph,
): { sorted: string[]; cyclicDirs: string[] } {
  const releaseDirs = new Set(releaseSet.keys());
  if (releaseDirs.size === 0) {
    return { sorted: [], cyclicDirs: [] };
  }

  // Build a forward adjacency list (dependency -> dependent) restricted to the release set.
  const inDegree = new Map<string, number>();
  const forwardEdges = new Map<string, string[]>();

  for (const dir of releaseDirs) {
    inDegree.set(dir, 0);
    forwardEdges.set(dir, []);
  }

  // For each released workspace, find its dependencies that are also in the release set.
  for (const [packageName, dependents] of graph.dependentsOf) {
    const depDir = graph.packageNameToDir.get(packageName);
    if (depDir === undefined || !releaseDirs.has(depDir)) {
      continue;
    }

    for (const dependent of dependents) {
      if (!releaseDirs.has(dependent.dir)) {
        continue;
      }

      const edges = forwardEdges.get(depDir);
      if (edges !== undefined) {
        edges.push(dependent.dir);
      }

      inDegree.set(dependent.dir, (inDegree.get(dependent.dir) ?? 0) + 1);
    }
  }

  // Kahn's algorithm.
  const queue: string[] = [];
  for (const [dir, degree] of inDegree) {
    if (degree === 0) {
      queue.push(dir);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) {
      break;
    }
    sorted.push(dir);

    for (const dependent of forwardEdges.get(dir) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Append any remaining (cyclic) nodes.
  const sortedSet = new Set(sorted);
  const cyclicDirs: string[] = [];
  for (const dir of releaseDirs) {
    if (!sortedSet.has(dir)) {
      sorted.push(dir);
      cyclicDirs.push(dir);
    }
  }

  return { sorted, cyclicDirs };
}

/** Return the workspace's derived tag prefix followed by each declared legacy-identity tag prefix. */
function getAllTagPrefixes(workspace: WorkspaceConfig): string[] {
  return [workspace.tagPrefix, ...(workspace.legacyIdentities?.map((identity) => identity.tagPrefix) ?? [])];
}
