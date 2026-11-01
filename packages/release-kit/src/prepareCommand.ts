/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { execSync } from 'node:child_process';

import { formatGlyphLine, type OutputStyle, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { assertCleanWorkingTree } from './assertCleanWorkingTree.ts';
import { assertReleasesOnNpm } from './assertReleasesOnNpm.ts';
import { assertTarballsComplete } from './assertTarballsComplete.ts';
import type { ReleaseKitConfig } from './configSchema.ts';
import { describeEmptyWorkspace, discoverWorkspaces, type WorkspaceDiscovery } from './discoverWorkspaces.ts';
import { dim } from './format.ts';
import { RELEASE_GLYPHS } from './glyphs.ts';
import { loadValidatedConfig, reportConfigProblem, reportConfigWarnings } from './loadValidatedConfig.ts';
import { CANONICAL_SEMVER_PATTERN, parseArgs, parseSetVersions } from './prepareArgs.ts';
import { prepareReleaseTargets, type TargetPrepareOptions } from './prepareReleaseTargets.ts';
import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';
import { applyReleasePlan, type ReleasePlan } from './releasePlan.ts';
import { reportPrepare } from './reportPrepare.ts';
import { resolveConfigFlag } from './resolveConfigFlag.ts';
import {
  isSinglePackageTargets,
  PROJECT_TARGET_ID,
  type ResolvedReleaseTargets,
  resolveReleaseTargets,
  SINGLE_PACKAGE_TARGET_ID,
} from './resolveReleaseTargets.ts';
import type { ReleaseTarget } from './types.ts';

/**
 * Orchestrates the CLI `prepare` command: checks the working tree, loads and validates the config, discovers the
 * workspaces, and prepares the release over the targets of the repo shape.
 *
 * A relative `--config` resolves against `invocationDir`.
 */
export async function prepareCommand(argv: string[], styles: StreamStyles, invocationDir: string): Promise<void> {
  const {
    configPath: configFlag,
    isDryRun,
    shouldForce,
    shouldSkipGitChecks,
    bumpOverride,
    onlyNames,
    setVersion,
    shouldIncludeReleaseNotes,
  } = parseArgs(argv);
  const options = {
    shouldForce,
    ...(bumpOverride !== undefined && { bumpOverride }),
    ...(shouldIncludeReleaseNotes && { shouldIncludeReleaseNotes: true }),
  };

  if (isDryRun) {
    console.info(
      `\n${formatGlyphLine(RELEASE_GLYPHS, styles.stdout, 'dryRun', 'DRY RUN: release-kit will not modify any files')}\n`,
    );
  }

  if (!isDryRun && !shouldSkipGitChecks) {
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

  let workspaceDiscovery: WorkspaceDiscovery;
  try {
    workspaceDiscovery = discoverWorkspaces();
  } catch (error: unknown) {
    reportError(`Failed to discover workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  if (workspaceDiscovery.kind === 'empty') {
    reportError(`No workspace package to release. ${describeEmptyWorkspace(workspaceDiscovery)}`);
    process.exit(1);
  }

  const config = resolveTargetsOrExit(userConfig, workspaceDiscovery, onlyNames, setVersion);
  const targetOptions: TargetPrepareOptions = {
    ...options,
    ...(onlyNames !== undefined && { onlyTargetIds: onlyNames }),
    ...(setVersion !== undefined && { versionOverridesById: resolveSetVersions(setVersion, config.targets) }),
  };
  runAndReport(
    () => {
      const plan = prepareReleaseTargets(config, targetOptions);
      const releasedPackagePaths = findReleasedPackagePaths(plan, config.targets);
      assertReleasesOnNpm(releasedPackagePaths);
      assertTarballsComplete(releasedPackagePaths, []);
      return plan;
    },
    isDryRun,
    styles.stdout,
  );
}

/** Returns the repo-relative paths of the package targets that a plan releases, in target order. */
function findReleasedPackagePaths(plan: ReleasePlan, targets: readonly ReleaseTarget[]): string[] {
  const releasedIds = new Set(
    plan.targets.flatMap((result) =>
      result.status === 'released' && result.kind === 'package' ? result.targetId : [],
    ),
  );
  return targets.flatMap((target) =>
    target.kind === 'package' && releasedIds.has(target.id) ? target.packagePath : [],
  );
}

/**
 * Resolves the release targets of the discovered repo shape, checking `--only` and `--set-version` against them.
 * Prints a usage error and exits on a flag that the shape rejects or a name that it lacks. A monorepo's config-merge
 * error is reported and exits; a single-package config-merge error propagates.
 */
function resolveTargetsOrExit(
  userConfig: ReleaseKitConfig | undefined,
  discovery: Exclude<WorkspaceDiscovery, { kind: 'empty' }>,
  onlyNames: string[] | undefined,
  setVersion: string | undefined,
): ResolvedReleaseTargets {
  if (discovery.kind === 'single-package') {
    if (onlyNames !== undefined) {
      reportError('--only is only supported for monorepo configurations');
      process.exit(1);
    }
    if (setVersion !== undefined && !CANONICAL_SEMVER_PATTERN.test(setVersion)) {
      reportError(
        `Invalid --set-version value "${setVersion}". Must be canonical semver (N.N.N, no pre-release suffix).`,
      );
      process.exit(1);
    }
    return resolveReleaseTargets(userConfig, discovery);
  }

  let config: ResolvedReleaseTargets;
  try {
    config = resolveReleaseTargets(userConfig, discovery);
  } catch (error: unknown) {
    reportError(`Failed to resolve workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  // A project release derives its bump from the commits of every contributing workspace, and `prepare` doesn't accept
  // any flag that overrides the project version, so `--set-version`, which sets individual workspaces' versions, does
  // not compose with it.
  if (setVersion !== undefined && config.targets.some((target) => target.kind === 'composite')) {
    reportError(
      '--set-version cannot be combined with a project release. ' +
        "--set-version sets individual workspaces' versions; a project release rolls up every " +
        'contributing workspace. To use --set-version, run on a config without a `project` block or a `releases` composite.',
    );
    process.exit(1);
  }

  const knownNames = listSelectableIds(config.targets);
  const requestedNames = onlyNames ?? [];
  for (const name of requestedNames) {
    if (knownNames.includes(name)) {
      continue;
    }

    reportError(`Unknown release target "${name}". Known targets: ${knownNames.join(', ')}`);
    process.exit(1);
  }

  return config;
}

/**
 * Keys the `--set-version` value by target id: a single-package repo's bare version under its root target, or a
 * monorepo's `<target>@N.N.N` entries under their workspace or directory targets.
 */
function resolveSetVersions(setVersion: string, targets: readonly ReleaseTarget[]): Map<string, string> {
  if (isSinglePackageTargets(targets)) {
    return new Map([[SINGLE_PACKAGE_TARGET_ID, setVersion]]);
  }
  return parseSetVersions(setVersion, listMemberIds(targets));
}

/** Returns the ids of the targets that `--only` can name, in target order: all but a `project` block's composite. */
function listSelectableIds(targets: readonly ReleaseTarget[]): string[] {
  return targets.flatMap((target) => (target.id === PROJECT_TARGET_ID ? [] : target.id));
}

/** Returns the ids of the package and directory targets, which `--set-version` can name, in target order. */
function listMemberIds(targets: readonly ReleaseTarget[]): string[] {
  return targets.flatMap((target) => (target.kind === 'composite' ? [] : target.id));
}

/**
 * Computes the release plan, applies it, runs the format command, and prints the report.
 *
 * The plan is applied before anything is printed, so a partially applied plan is never preceded
 * by a report that indicates success. The format command runs last because it rewrites the files
 * that the plan just wrote. Its failure leaves the release on disk and the tags file in place;
 * `release-kit commit` still proceeds.
 */
function runAndReport(computePlan: () => ReleasePlan, isDryRun: boolean, style: OutputStyle): void {
  let plan: ReleasePlan;
  try {
    plan = computePlan();
  } catch (error: unknown) {
    reportError(describeError(error));
    process.stderr.write('The command did not write any files; the working tree is unchanged.\n');
    process.exit(1);
  }

  if (isDryRun) {
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

  if (formatError === undefined) {
    return;
  }

  reportError(
    `The format command failed, but the release is prepared and ${RELEASE_TAGS_FILE} is written. ` +
      `Format the release files and run 'release-kit commit'.`,
  );
  process.exit(1);
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
function reportPlanFiles(plan: ReleasePlan, isDryRun: boolean): void {
  if (plan.tags.length === 0) {
    return;
  }

  if (isDryRun) {
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
