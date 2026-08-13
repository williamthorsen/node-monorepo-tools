/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { execSync } from 'node:child_process';

import { parseArgsOrExit, reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { assertCleanWorkingTree } from './assertCleanWorkingTree.ts';
import { buildDependencyGraph } from './buildDependencyGraph.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { dim } from './format.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { loadConfig, mergeMonorepoConfig, mergeSinglePackageConfig, readRootPackageVersion } from './loadConfig.ts';
import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';
import type { ReleasePlan } from './releasePlan.ts';
import { applyReleasePlan } from './releasePlan.ts';
import { releasePrepare } from './releasePrepare.ts';
import { releasePrepareMono } from './releasePrepareMono.ts';
import { reportPrepare } from './reportPrepare.ts';
import type { MonorepoReleaseConfig, ReleaseKitConfig, ReleaseType } from './types.ts';
import { validateConfig } from './validateConfig.ts';
import { validateOnlyExcludesStrandedDependents } from './validateOnlyExcludesStrandedDependents.ts';

const VALID_BUMP_TYPES: readonly string[] = ['major', 'minor', 'patch'];

/** Canonical `N.N.N` semver pattern for validating `--set-version` input. */
const CANONICAL_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function isReleaseType(value: string): value is ReleaseType {
  return VALID_BUMP_TYPES.includes(value);
}

export const prepareFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  force: { long: '--force', type: 'boolean' as const },
  noGitChecks: {
    long: '--no-git-checks',
    type: 'boolean' as const,
    short: '-n',
  },
  bump: { long: '--bump', type: 'string' as const },
  setVersion: { long: '--set-version', type: 'string' as const },
  only: { long: '--only', type: 'string' as const },
  withReleaseNotes: { long: '--with-release-notes', type: 'boolean' as const },
};

/** Parses CLI arguments into structured options. Prints a usage error and exits on invalid input. */
export function parseArgs(argv: string[]): {
  dryRun: boolean;
  force: boolean;
  noGitChecks: boolean;
  bumpOverride: ReleaseType | undefined;
  only: string[] | undefined;
  setVersion: string | undefined;
  withReleaseNotes: boolean;
} {
  const { flags } = parseArgsOrExit(argv, prepareFlagSchema);

  let bumpOverride: ReleaseType | undefined;
  if (flags.bump !== undefined) {
    if (!isReleaseType(flags.bump)) {
      reportError(`Invalid bump type "${flags.bump}". Must be one of: ${VALID_BUMP_TYPES.join(', ')}`);
      process.exit(1);
    }
    bumpOverride = flags.bump;
  }

  let setVersion: string | undefined;
  if (flags.setVersion !== undefined) {
    if (!CANONICAL_SEMVER_PATTERN.test(flags.setVersion)) {
      reportError(
        `Invalid --set-version value "${flags.setVersion}". Must be canonical semver (N.N.N, no pre-release suffix).`,
      );
      process.exit(1);
    }
    setVersion = flags.setVersion;
  }

  let only: string[] | undefined;
  if (flags.only !== undefined) {
    only = flags.only.split(',');
  }

  if (setVersion !== undefined && bumpOverride !== undefined) {
    reportError('--set-version cannot be combined with --bump');
    process.exit(1);
  }

  if (setVersion !== undefined && flags.force) {
    reportError('--set-version cannot be combined with --force');
    process.exit(1);
  }

  return {
    dryRun: flags.dryRun,
    force: flags.force,
    noGitChecks: flags.noGitChecks,
    bumpOverride,
    only,
    setVersion,
    withReleaseNotes: flags.withReleaseNotes,
  };
}

/**
 * Orchestrates the CLI `prepare` command.
 *
 * 1. Discovers workspaces from `pnpm-workspace.yaml`.
 * 2. Loads and validates `.config/release-kit.config.ts` (if present).
 * 3. Merges discovered defaults with user config.
 * 4. Delegates to `releasePrepare` or `releasePrepareMono` to compute the release plan.
 * 5. Applies the plan, runs the format command, and prints the result via `reportPrepare`.
 */
export async function prepareCommand(argv: string[]): Promise<void> {
  const { dryRun, force, noGitChecks, bumpOverride, only, setVersion, withReleaseNotes } = parseArgs(argv);
  const options = {
    force,
    ...(bumpOverride !== undefined && { bumpOverride }),
    ...(setVersion !== undefined && { setVersion }),
    ...(withReleaseNotes && { withReleaseNotes: true }),
  };

  if (dryRun) {
    console.info('\n🔍 DRY RUN — no files will be modified\n');
  }

  // Guard against running on a dirty working tree (skip for dry runs and --no-git-checks).
  if (!dryRun && !noGitChecks) {
    try {
      assertCleanWorkingTree();
    } catch (error: unknown) {
      reportError(describeError(error));
      process.exit(1);
    }
  }

  const userConfig = await loadAndValidateConfig();

  // 3. Discover workspaces
  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discoverWorkspaces();
  } catch (error: unknown) {
    reportError(`Failed to discover workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  // 4. Determine mode, merge config, and run
  if (discoveredPaths === undefined) {
    runSinglePackageMode(userConfig, options, only, dryRun);
  } else {
    runMonorepoMode(discoveredPaths, userConfig, options, only, setVersion, dryRun);
  }
}

function runSinglePackageMode(
  userConfig: ReleaseKitConfig | undefined,
  options: PrepareOptions,
  only: string[] | undefined,
  dryRun: boolean,
): void {
  if (only !== undefined) {
    reportError('--only is only supported for monorepo configurations');
    process.exit(1);
  }

  // The orthogonal `--force` model — release at patch when no commits or no bump-worthy
  // commits exist — is implemented only in `releasePrepareMono`. The single-package
  // executor (`releasePrepare`) deliberately retains the legacy `determineBumpFromCommits`
  // semantics, so a bare `--force` is silently ignored there. Reject it explicitly rather
  // than letting the user discover the gap from a missing release. `--force --bump=X` is
  // accepted because the `--bump` override carries the release through unconditionally.
  if (options.force && options.bumpOverride === undefined) {
    reportError(
      '--force without --bump is only supported for monorepo configurations. ' +
        'Use --bump=major|minor|patch to set the level for a single-package release.',
    );
    process.exit(1);
  }

  const config = mergeSinglePackageConfig(userConfig);
  runAndReport(() => releasePrepare(config, options), dryRun);
}

function runMonorepoMode(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
  options: PrepareOptions,
  only: string[] | undefined,
  setVersion: string | undefined,
  dryRun: boolean,
): void {
  let config: MonorepoReleaseConfig;
  try {
    // Read the root package.json once so `mergeMonorepoConfig` (a pure transform) can
    // validate the project block's prerequisites without doing I/O of its own.
    const rootPackage = readRootPackageVersion();
    config = mergeMonorepoConfig(discoveredPaths, userConfig, rootPackage);
  } catch (error: unknown) {
    reportError(`Failed to resolve workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  // Reject `--set-version` when a project block is configured. `--set-version` is a workspace
  // operation; a project release rolls up every contributing workspace and derives its bump
  // from commits in the contributing-paths window — there is no flag designed to override the
  // project version directly, and the two semantics do not compose. Runs before the `--only`
  // rejection so a user passing `--set-version` (the primary intent) sees the project-aware
  // error rather than the secondary `--only` error when both flags are supplied.
  if (setVersion !== undefined && config.project !== undefined) {
    reportError(
      '--set-version cannot be combined with a project release. ' +
        '--set-version operates on a single workspace; a project release rolls up every ' +
        'contributing workspace. To use --set-version, run on a config without a `project` block.',
    );
    process.exit(1);
  }

  // Reject `--only` when a project block is configured. Project releases roll up every
  // contributing workspace; narrowing to a single workspace would produce ambiguous semantics
  // around which workspaces participate in the project bump. A consumer that needs to release
  // a single workspace must do so on a config without a `project` block.
  if (only !== undefined && config.project !== undefined) {
    reportError(
      '--only cannot be combined with a project release. ' +
        'To release a single workspace, use a config without a `project` block, ' +
        'or run a full `prepare` (no --only) to include the project release.',
    );
    process.exit(1);
  }

  if (only !== undefined) {
    const knownNames = config.workspaces.map((w) => w.dir);

    // Validate all names before mutating config
    for (const name of only) {
      if (knownNames.includes(name)) {
        continue;
      }

      reportError(`Unknown workspace "${name}". Known workspaces: ${knownNames.join(', ')}`);
      process.exit(1);
    }

    // Reject `--only` invocations that would silently strand changes in excluded internal
    // dependents. Runs before the filter mutates `config.workspaces` so the validator sees
    // the full pre-filter graph.
    const graph = buildDependencyGraph(config.workspaces);
    const violations = validateOnlyExcludesStrandedDependents(config.workspaces, only, graph, (workspace) => {
      const tagPrefixes = [
        workspace.tagPrefix,
        ...(workspace.legacyIdentities?.map((identity) => identity.tagPrefix) ?? []),
      ];
      const result = getCommitsSinceTarget(tagPrefixes, workspace.paths);
      return { has: result.commits.length > 0, tag: result.tag };
    });

    if (violations !== undefined) {
      reportError('--only excludes packages with changes that would be stranded by the release.');
      process.stderr.write('The following packages must be added to --only or have their dependencies removed:\n');
      for (const violation of violations) {
        const since = violation.tag ?? 'the beginning';
        process.stderr.write(
          `  - ${violation.dir} (downstream of ${violation.downstreamOf}; has commits since ${since})\n`,
        );
      }
      process.stderr.write('Alternatively, run `release-kit prepare` without --only to release everything.\n');
      process.exit(1);
    }

    config.workspaces = config.workspaces.filter((w) => only.includes(w.dir));
  }

  // --set-version requires exactly one target workspace in monorepo mode.
  if (setVersion !== undefined) {
    if (only === undefined) {
      reportError('--set-version requires --only in monorepo mode');
      process.exit(1);
    }
    if (config.workspaces.length !== 1) {
      reportError(`--set-version requires --only to match exactly one workspace; matched ${config.workspaces.length}`);
      process.exit(1);
    }
  }

  runAndReport(() => releasePrepareMono(config, options), dryRun);
}

interface PrepareOptions {
  force: boolean;
  bumpOverride?: ReleaseType;
  setVersion?: string;
  withReleaseNotes?: boolean;
}

/** Loads and validate the release-kit config file, exiting on errors. */
async function loadAndValidateConfig(): Promise<ReleaseKitConfig | undefined> {
  let rawConfig: unknown;
  try {
    rawConfig = await loadConfig();
  } catch (error: unknown) {
    reportError(`Failed to load config: ${describeError(error)}`);
    process.exit(1);
  }

  if (rawConfig === undefined) {
    return undefined;
  }

  const { config, errors, warnings } = validateConfig(rawConfig);
  if (errors.length > 0) {
    process.stderr.write('Invalid config:\n');
    for (const err of errors) {
      process.stderr.write(`  ❌ ${err}\n`);
    }
    process.exit(1);
  }

  for (const warning of warnings) {
    console.warn(`  ⚠️  ${warning}`);
  }

  return config;
}

/**
 * Computes the release plan, applies it, runs the format command, and prints the report.
 *
 * The plan is applied before anything is printed, so a partially applied plan is never preceded
 * by a success-shaped report. The format command runs last because it rewrites the very files
 * the plan just put on disk; its failure leaves the release materialized and the tags file in
 * place, so `release-kit commit` still proceeds.
 */
function runAndReport(computePlan: () => ReleasePlan, dryRun: boolean): void {
  let plan: ReleasePlan;
  try {
    plan = computePlan();
  } catch (error: unknown) {
    reportError(describeError(error));
    process.stderr.write('No files were written; the working tree is unchanged.\n');
    process.exit(1);
  }

  if (dryRun) {
    process.stdout.write(reportPrepare(plan, { applied: false }) + '\n');
    reportPlanFiles(plan, true);
    return;
  }

  try {
    applyReleasePlan(plan);
  } catch (error: unknown) {
    reportError(describeError(error));
    process.exit(1);
  }

  const formatError = runFormatCommand(plan.formatCommand);

  process.stdout.write(
    reportPrepare(plan, { applied: true, ...(formatError !== undefined && { formatError }) }) + '\n',
  );
  reportPlanFiles(plan, false);

  if (formatError !== undefined) {
    reportError(
      `The format command failed, but the release is prepared and ${RELEASE_TAGS_FILE} is written. ` +
        `Format the release files and run 'release-kit commit'.`,
    );
    process.exit(1);
  }
}

/**
 * Runs the plan's format command, returning its failure message if it fails.
 *
 * Never throws. By the time this runs the release is already on disk, so a formatting failure is
 * reported rather than allowed to unmake it.
 */
function runFormatCommand(formatCommand: ReleasePlan['formatCommand']): string | undefined {
  if (formatCommand === undefined) {
    return undefined;
  }

  try {
    execSync(formatCommand.command, { stdio: 'inherit' });
    return undefined;
  } catch (error: unknown) {
    return describeError(error);
  }
}

/** Reports the tags and summary files the plan carries, in the prepare command's dim style. */
function reportPlanFiles(plan: ReleasePlan, dryRun: boolean): void {
  if (plan.tags.length === 0) {
    return;
  }

  if (dryRun) {
    console.info(dim(`  [dry-run] Would write ${RELEASE_TAGS_FILE}: ${plan.tags.join(' ')}`));
    if (plan.summary.length > 0) {
      console.info(dim(`  [dry-run] Would write ${RELEASE_SUMMARY_FILE}`));
    }
    return;
  }

  console.info(dim(`  Wrote ${RELEASE_TAGS_FILE}: ${plan.tags.join(' ')}`));
  console.info(dim(`\n   Release tags file: ${RELEASE_TAGS_FILE}`));
  if (plan.summary.length > 0) {
    console.info(dim(`  Wrote ${RELEASE_SUMMARY_FILE}`));
  }

  process.stderr.write(`\nRun 'release-kit commit' to create the release commit.\n`);
}
