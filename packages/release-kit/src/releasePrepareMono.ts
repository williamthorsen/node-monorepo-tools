import { execSync } from 'node:child_process';

import type { DependencyGraph } from './buildDependencyGraph.ts';
import { buildDependencyGraph } from './buildDependencyGraph.ts';
import { bumpAllVersions, setAllVersions } from './bumpAllVersions.ts';
import { isForwardVersion } from './compareVersions.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
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
  ComponentConfig,
  ComponentPrepareResult,
  MonorepoReleaseConfig,
  PrepareResult,
  ReleaseType,
} from './types.ts';
import { writeSyntheticChangelog } from './writeSyntheticChangelog.ts';

/** Intermediate result from Phase 1 (determine direct bumps). */
interface DirectBumpResult {
  component: ComponentConfig;
  tag: string | undefined;
  commits: Commit[];
  /** Release type determined from commits (or the override). Undefined when `setVersion` is used. */
  releaseType: ReleaseType | undefined;
  parsedCommitCount: number | undefined;
  unparseableCommits: Commit[] | undefined;
  /** Explicit version from `--set-version`, present only for the overridden component. */
  setVersion?: string;
}

/** Intermediate result for a skipped component. */
interface SkippedResult {
  component: ComponentConfig;
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
 * Orchestrate release preparation for a monorepo with multiple components.
 *
 * Phase 1: Determine direct bumps from commits for each component.
 * Phase 2: Build the dependency graph and propagate bumps to dependents.
 * Phase 2b: Topologically sort the full release set.
 * Phase 3: Execute bumps and generate changelogs in dependency order.
 */
export function releasePrepareMono(config: MonorepoReleaseConfig, options: ReleasePrepareOptions): PrepareResult {
  const { dryRun } = options;

  // === Phase 1: Determine direct bumps ===
  const { directBumps, directResults, skippedResults, currentVersions } = determineDirectBumps(config, options);

  // Build a lookup of previous tags for all components (needed for propagated ones).
  const previousTags = new Map<string, string | undefined>();
  for (const result of directResults.values()) {
    previousTags.set(result.component.dir, result.tag);
  }
  for (const skipped of skippedResults) {
    previousTags.set(skipped.component.dir, skipped.tag);
  }

  // === Phase 2: Build graph and propagate bumps ===
  const graph = buildDependencyGraph(config.components);
  const fullReleaseSet = propagateBumps(directBumps, graph, currentVersions);

  // === Phase 2b: Topologically sort the release set ===
  const { sorted: sortedDirs, cyclicDirs } = topologicalSort(fullReleaseSet, graph);
  const warnings: string[] = [];
  if (cyclicDirs.length > 0) {
    warnings.push(
      `Circular workspace dependencies detected among: ${cyclicDirs.join(', ')}. ` +
        'Propagation metadata may be incomplete for these components.',
    );
  }

  // === Phase 3: Execute bumps and generate changelogs ===
  const components = collectSkippedComponents(skippedResults, fullReleaseSet);
  const { tags, modifiedFiles } = executeReleaseSet(
    sortedDirs,
    fullReleaseSet,
    config,
    directResults,
    previousTags,
    dryRun,
    components,
  );

  // Reorder components to match original config order.
  const configOrder = new Map(config.components.map((c, i) => [c.dir, i]));
  components.sort((a, b) => {
    const orderA = configOrder.get(a.name ?? '') ?? 0;
    const orderB = configOrder.get(b.name ?? '') ?? 0;
    return orderA - orderB;
  });

  // === Phase 4: Format ===
  const formatCommand = runFormatCommand(config, tags, modifiedFiles, dryRun);

  return {
    components,
    tags,
    formatCommand,
    dryRun,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** Determine direct bumps from commits for each component. */
function determineDirectBumps(config: MonorepoReleaseConfig, options: ReleasePrepareOptions): Phase1Result {
  const { force, bumpOverride, setVersion } = options;

  // Enforce the `--set-version` contract at the orchestration layer. The CLI layer
  // (`prepareCommand`) normally narrows to a single component before calling, but this
  // guard protects against programmatic misuse.
  if (setVersion !== undefined && config.components.length !== 1) {
    throw new Error(`--set-version requires exactly one component; received ${config.components.length}`);
  }

  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };

  const directBumps = new Map<string, ReleaseEntry>();
  const directResults = new Map<string, DirectBumpResult>();
  const skippedResults: SkippedResult[] = [];
  const currentVersions: CurrentVersions = new Map();

  for (const component of config.components) {
    const name = component.dir;
    const { tag, commits } = getCommitsSinceTarget(component.tagPrefix, component.paths);
    const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

    // Read current version from the first package file.
    // Important: this read must occur BEFORE any bypass branch so propagation sees the
    // pre-write current version.
    const primaryPackageFile = component.packageFiles[0];
    if (primaryPackageFile !== undefined) {
      const currentVersion = readCurrentVersion(primaryPackageFile);
      if (currentVersion !== undefined) {
        currentVersions.set(component.dir, currentVersion);
      }
    }

    // --set-version bypass: skip commit-derived bump logic for the overridden component.
    // Validation that only one component is targeted runs in `prepareCommand` before this function.
    if (setVersion !== undefined) {
      const currentVersion = currentVersions.get(component.dir);
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
      directBumps.set(component.dir, { releaseType: 'patch', newVersionOverride: setVersion });
      directResults.set(component.dir, {
        component,
        tag,
        commits,
        releaseType: undefined,
        parsedCommitCount: undefined,
        unparseableCommits: undefined,
        setVersion,
      });
      continue;
    }

    // Skip components with no changes unless --force is set.
    if (commits.length === 0 && !force) {
      skippedResults.push({
        component,
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
        component,
        tag,
        commitCount: commits.length,
        parsedCommitCount,
        unparseableCommits,
        skipReason: `No release-worthy changes for ${name} ${since}. Skipping.`,
      });
      continue;
    }

    directBumps.set(component.dir, { releaseType });
    directResults.set(component.dir, {
      component,
      tag,
      commits,
      releaseType,
      parsedCommitCount,
      unparseableCommits,
    });
  }

  return { directBumps, directResults, skippedResults, currentVersions };
}

/** Collect skipped components, excluding those promoted via propagation. */
function collectSkippedComponents(
  skippedResults: SkippedResult[],
  fullReleaseSet: Map<string, ReleaseEntry>,
): ComponentPrepareResult[] {
  const components: ComponentPrepareResult[] = [];
  for (const skipped of skippedResults) {
    if (fullReleaseSet.has(skipped.component.dir)) {
      continue;
    }
    components.push({
      name: skipped.component.dir,
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
  return components;
}

/** Execute bumps and generate changelogs for each component in dependency order. */
function executeReleaseSet(
  sortedDirs: string[],
  fullReleaseSet: Map<string, ReleaseEntry>,
  config: MonorepoReleaseConfig,
  directResults: Map<string, DirectBumpResult>,
  previousTags: Map<string, string | undefined>,
  dryRun: boolean,
  components: ComponentPrepareResult[],
): { tags: string[]; modifiedFiles: string[] } {
  const tags: string[] = [];
  const modifiedFiles: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const dir of sortedDirs) {
    const releaseEntry = fullReleaseSet.get(dir);
    if (releaseEntry === undefined) {
      continue;
    }

    const component = findComponent(config.components, dir);
    if (component === undefined) {
      continue;
    }

    executeComponentRelease({
      dir,
      component,
      releaseEntry,
      directResult: directResults.get(dir),
      previousTags,
      config,
      dryRun,
      today,
      tags,
      modifiedFiles,
      components,
    });
  }

  return { tags, modifiedFiles };
}

/** Arguments for executing a single component's bump + changelog generation. */
interface ExecuteComponentReleaseArgs {
  dir: string;
  component: ComponentConfig;
  releaseEntry: ReleaseEntry;
  directResult: DirectBumpResult | undefined;
  previousTags: Map<string, string | undefined>;
  config: MonorepoReleaseConfig;
  dryRun: boolean;
  today: string;
  tags: string[];
  modifiedFiles: string[];
  components: ComponentPrepareResult[];
}

/** Bump, generate changelogs, and append the component result for one entry in the release set. */
function executeComponentRelease(args: ExecuteComponentReleaseArgs): void {
  const {
    dir,
    component,
    releaseEntry,
    directResult,
    previousTags,
    config,
    dryRun,
    today,
    tags,
    modifiedFiles,
    components,
  } = args;

  // Bump all versions for this component. For --set-version components, write the explicit
  // version directly; otherwise compute the bump from the release type.
  const setVersionTarget = directResult?.setVersion;
  const bump =
    setVersionTarget === undefined
      ? bumpAllVersions(component.packageFiles, releaseEntry.releaseType, dryRun)
      : setAllVersions(component.packageFiles, setVersionTarget, dryRun);
  const newTag = `${component.tagPrefix}${bump.newVersion}`;
  tags.push(newTag);
  modifiedFiles.push(...component.packageFiles, ...component.changelogPaths.map((p) => `${p}/CHANGELOG.md`));

  const isPropagationOnly = directResult === undefined;
  const changelogFiles = generateComponentChangelogs({
    component,
    releaseEntry,
    newTag,
    newVersion: bump.newVersion,
    isPropagationOnly,
    config,
    dryRun,
    today,
    modifiedFiles,
  });

  components.push({
    name: dir,
    status: 'released',
    previousTag: directResult?.tag ?? previousTags.get(dir),
    commitCount: directResult?.commits.length ?? 0,
    parsedCommitCount: directResult?.parsedCommitCount,
    // For --set-version components releaseType is left undefined so reporting can branch
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

/** Arguments for generating changelog files for a single component. */
interface GenerateComponentChangelogsArgs {
  component: ComponentConfig;
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
 * Generate changelogs for a component: synthetic entries for propagation-only bumps, git-cliff
 * output for direct bumps (including `--set-version`). Returns the list of changelog files written.
 * Additional changelog JSON files are appended to `modifiedFiles` when the feature is enabled.
 */
function generateComponentChangelogs(args: GenerateComponentChangelogsArgs): string[] {
  const { component, releaseEntry, newTag, newVersion, isPropagationOnly, config, dryRun, today, modifiedFiles } = args;
  const changelogFiles: string[] = [];

  if (isPropagationOnly && releaseEntry.propagatedFrom !== undefined) {
    for (const changelogPath of component.changelogPaths) {
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
      for (const changelogPath of component.changelogPaths) {
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

  for (const changelogPath of component.changelogPaths) {
    changelogFiles.push(
      ...generateChangelog(config, changelogPath, newTag, dryRun, {
        tagPattern: buildTagPattern(component.tagPrefix),
        includePaths: component.paths,
      }),
    );
  }

  if (config.changelogJson.enabled) {
    for (const changelogPath of component.changelogPaths) {
      const jsonFiles = generateChangelogJson(config, changelogPath, newTag, dryRun, {
        tagPattern: buildTagPattern(component.tagPrefix),
        includePaths: component.paths,
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

/** Find a component by its `dir` in the components array. */
function findComponent(components: readonly ComponentConfig[], dir: string): ComponentConfig | undefined {
  return components.find((c) => c.dir === dir);
}

/**
 * Topologically sort component dirs so dependencies are processed before their dependents.
 *
 * Uses Kahn's algorithm. Components not in the release set are excluded. If the graph has
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

  // For each released component, find its dependencies that are also in the release set.
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
