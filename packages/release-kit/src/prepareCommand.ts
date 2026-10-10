/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { execSync } from 'node:child_process';

import {
  formatGlyphLine,
  type OutputStyle,
  parseArgsOrExit,
  reportError,
  type StreamStyles,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { assertCleanWorkingTree } from './assertCleanWorkingTree.ts';
import { assertReleasesOnNpm } from './assertReleasesOnNpm.ts';
import { configFlagSchema } from './configFlagSchema.ts';
import { describeEmptyWorkspace, discoverWorkspaces, type WorkspaceDiscovery } from './discoverWorkspaces.ts';
import { dim } from './format.ts';
import { RELEASE_GLYPHS } from './glyphs.ts';
import { mergeMonorepoConfig, mergeSinglePackageConfig, readRootPackageVersion } from './loadConfig.ts';
import { loadValidatedConfig, reportConfigProblem, reportConfigWarnings } from './loadValidatedConfig.ts';
import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';
import { applyReleasePlan, type ReleasePlan } from './releasePlan.ts';
import { releasePrepare } from './releasePrepare.ts';
import { type MonorepoPrepareOptions, releasePrepareMono } from './releasePrepareMono.ts';
import { reportPrepare } from './reportPrepare.ts';
import { resolveConfigFlag } from './resolveConfigFlag.ts';
import type { MonorepoReleaseConfig, ReleaseKitConfig, ReleaseType, WorkspaceConfig } from './types.ts';

const VALID_BUMP_TYPES: readonly string[] = ['major', 'minor', 'patch'];

/** Canonical `N.N.N` semver pattern for validating `--set-version` input. */
const CANONICAL_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** Narrows a `--bump` value to a `ReleaseType`. */
function isReleaseType(value: string): value is ReleaseType {
  return VALID_BUMP_TYPES.includes(value);
}

export const prepareFlagSchema = {
  ...configFlagSchema,
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
  configPath: string | undefined;
  dryRun: boolean;
  force: boolean;
  noGitChecks: boolean;
  bumpOverride: ReleaseType | undefined;
  only: string[] | undefined;
  /** The raw `--set-version` value, whose accepted form depends on the mode. */
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

  let only: string[] | undefined;
  if (flags.only !== undefined) {
    only = flags.only.split(',');
  }

  return {
    configPath: flags.config,
    dryRun: flags.dryRun,
    force: flags.force,
    noGitChecks: flags.noGitChecks,
    bumpOverride,
    only,
    setVersion: flags.setVersion,
    withReleaseNotes: flags.withReleaseNotes,
  };
}

/**
 * Orchestrates the CLI `prepare` command: checks the working tree, loads and validates the config, discovers the
 * workspaces, and prepares the release in single-package or monorepo mode.
 *
 * A relative `--config` resolves against `invocationDir`.
 */
export async function prepareCommand(argv: string[], styles: StreamStyles, invocationDir: string): Promise<void> {
  const {
    configPath: configFlag,
    dryRun,
    force,
    noGitChecks,
    bumpOverride,
    only,
    setVersion,
    withReleaseNotes,
  } = parseArgs(argv);
  const options = {
    force,
    ...(bumpOverride !== undefined && { bumpOverride }),
    ...(withReleaseNotes && { withReleaseNotes: true }),
  };

  if (dryRun) {
    console.info(
      `\n${formatGlyphLine(RELEASE_GLYPHS, styles.stdout, 'dryRun', 'DRY RUN: release-kit will not modify any files')}\n`,
    );
  }

  if (!dryRun && !noGitChecks) {
    try {
      assertCleanWorkingTree();
    } catch (error: unknown) {
      reportError(describeError(error));
      process.exit(1);
    }
  }

  const configResult = await loadValidatedConfig(resolveConfigFlag(configFlag, invocationDir));
  if (configResult.status === 'invalid') {
    reportConfigProblem(configResult.problem, styles.stderr);
    process.exit(1);
  }

  let userConfig: ReleaseKitConfig | undefined;
  if (configResult.status === 'ok') {
    reportConfigWarnings(configResult.warnings, styles.stderr);
    userConfig = configResult.config;
  }

  let workspace: WorkspaceDiscovery;
  try {
    workspace = discoverWorkspaces();
  } catch (error: unknown) {
    reportError(`Failed to discover workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  if (workspace.kind === 'empty') {
    reportError(`No workspace package to release. ${describeEmptyWorkspace(workspace)}`);
    process.exit(1);
  }

  if (workspace.kind === 'single-package') {
    runSinglePackageMode(userConfig, options, only, setVersion, dryRun, styles.stdout);
  } else {
    runMonorepoMode(workspace.packageDirs, userConfig, options, only, setVersion, dryRun, styles.stdout);
  }
}

/** Prepares a single-package release, rejecting `--only` and accepting a bare `--set-version` version. */
function runSinglePackageMode(
  userConfig: ReleaseKitConfig | undefined,
  options: PrepareOptions,
  only: string[] | undefined,
  setVersion: string | undefined,
  dryRun: boolean,
  style: OutputStyle,
): void {
  if (only !== undefined) {
    reportError('--only is only supported for monorepo configurations');
    process.exit(1);
  }

  if (setVersion !== undefined && !CANONICAL_SEMVER_PATTERN.test(setVersion)) {
    reportError(
      `Invalid --set-version value "${setVersion}". Must be canonical semver (N.N.N, no pre-release suffix).`,
    );
    process.exit(1);
  }

  const config = mergeSinglePackageConfig(userConfig);
  runAndReport(
    () => {
      const plan = releasePrepare(config, { ...options, ...(setVersion !== undefined && { setVersion }) });
      assertReleasesOnNpm(plan.workspaces.some((result) => result.status === 'released') ? ['.'] : []);
      return plan;
    },
    dryRun,
    style,
  );
}

/** Prepares a monorepo release, validating `--only` and `--set-version` against the merged config. */
function runMonorepoMode(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
  options: PrepareOptions,
  only: string[] | undefined,
  setVersion: string | undefined,
  dryRun: boolean,
  style: OutputStyle,
): void {
  let config: MonorepoReleaseConfig;
  try {
    const rootPackage = readRootPackageVersion();
    config = mergeMonorepoConfig(discoveredPaths, userConfig, rootPackage);
  } catch (error: unknown) {
    reportError(`Failed to resolve workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  // A project release derives its bump from the commits of every contributing workspace, and `prepare` doesn't accept
  // any flag that overrides the project version, so `--set-version`, which sets individual workspaces' versions, does
  // not compose with it.
  if (setVersion !== undefined && config.project !== undefined) {
    reportError(
      '--set-version cannot be combined with a project release. ' +
        "--set-version sets individual workspaces' versions; a project release rolls up every " +
        'contributing workspace. To use --set-version, run on a config without a `project` block.',
    );
    process.exit(1);
  }

  const knownNames = config.workspaces.map((w) => w.dir);
  const onlyNames = only ?? [];
  for (const name of onlyNames) {
    if (knownNames.includes(name)) {
      continue;
    }

    reportError(`Unknown workspace "${name}". Known workspaces: ${knownNames.join(', ')}`);
    process.exit(1);
  }

  const monorepoOptions: MonorepoPrepareOptions = {
    ...options,
    ...(only !== undefined && { only }),
    ...(setVersion !== undefined && { setVersions: parseSetVersions(setVersion, knownNames) }),
  };
  runAndReport(
    () => {
      const plan = releasePrepareMono(config, monorepoOptions);
      assertReleasesOnNpm(findReleasedWorkspacePaths(plan, config.workspaces));
      return plan;
    },
    dryRun,
    style,
  );
}

/** Returns the repo-relative paths of the workspaces that a monorepo plan releases, excluding the project release. */
function findReleasedWorkspacePaths(plan: ReleasePlan, workspaces: readonly WorkspaceConfig[]): string[] {
  // A monorepo result's `name` is the workspace's `dir`.
  const releasedDirs = new Set(
    plan.workspaces.flatMap((result) =>
      result.status === 'released' && result.name !== undefined ? [result.name] : [],
    ),
  );
  return workspaces.filter((workspace) => releasedDirs.has(workspace.dir)).map((workspace) => workspace.workspacePath);
}

interface PrepareOptions {
  force: boolean;
  bumpOverride?: ReleaseType;
  withReleaseNotes?: boolean;
}

/**
 * Parses a monorepo `--set-version` value, a comma-separated list of `<workspace>@N.N.N` entries, into versions keyed by
 * workspace `dir`. Prints a usage error and exits on a malformed entry, an unknown workspace, or a repeated one.
 */
function parseSetVersions(value: string, knownNames: readonly string[]): Map<string, string> {
  const setVersions = new Map<string, string>();
  for (const entry of value.split(',')) {
    const separatorIndex = entry.lastIndexOf('@');
    const name = entry.slice(0, Math.max(0, separatorIndex));
    const version = entry.slice(separatorIndex + 1);
    if (separatorIndex <= 0 || !CANONICAL_SEMVER_PATTERN.test(version)) {
      reportError(
        `Invalid --set-version entry "${entry}". In monorepo mode, each entry must be <workspace>@N.N.N ` +
          '(canonical semver, no pre-release suffix), e.g. --set-version=arrays@1.0.0.',
      );
      process.exit(1);
    }
    if (!knownNames.includes(name)) {
      reportError(`Unknown workspace "${name}" in --set-version. Known workspaces: ${knownNames.join(', ')}`);
      process.exit(1);
    }
    if (setVersions.has(name)) {
      reportError(`--set-version names workspace "${name}" more than once`);
      process.exit(1);
    }
    setVersions.set(name, version);
  }
  return setVersions;
}

/**
 * Computes the release plan, applies it, runs the format command, and prints the report.
 *
 * The plan is applied before anything is printed, so a partially applied plan is never preceded
 * by a report that indicates success. The format command runs last because it rewrites the files
 * that the plan just wrote. Its failure leaves the release on disk and the tags file in place;
 * `release-kit commit` still proceeds.
 */
function runAndReport(computePlan: () => ReleasePlan, dryRun: boolean, style: OutputStyle): void {
  let plan: ReleasePlan;
  try {
    plan = computePlan();
  } catch (error: unknown) {
    reportError(describeError(error));
    process.stderr.write('The command did not write any files; the working tree is unchanged.\n');
    process.exit(1);
  }

  if (dryRun) {
    process.stdout.write(reportPrepare(plan, { applied: false, style }) + '\n');
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
    reportPrepare(plan, { applied: true, style, ...(formatError !== undefined && { formatError }) }) + '\n',
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
 * reported rather than allowed to undo it.
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

/** Reports the tags and summary files that the plan writes, in the prepare command's dim style. */
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
