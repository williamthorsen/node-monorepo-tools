import {
  formatGlyphLine,
  isAnticipatedFailure,
  type OutputStyle,
  type StreamStyles,
  UserError,
} from '@williamthorsen/nmr-core';
import { UsageError } from '@williamthorsen/nmr-core/cli';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { parseChangelogEntries } from '../changelog/changelog-entries.ts';
import { resolveChangelogJsonPath } from '../changelog/changelog-json-file.ts';
import { dim } from '../cli/format.ts';
import { RELEASE_GLYPHS } from '../cli/glyphs.ts';
import { realGit } from '../clients/git/git.ts';
import { realShell, type Shell } from '../clients/shell/shell.ts';
import type { ReleaseKitConfig } from '../config/config-schema.ts';
import { deriveReleaseNotesConfig } from '../config/deriveReleaseNotesConfig.ts';
import { ConfigProblemError, loadValidatedConfig, reportConfigWarnings } from '../config/loadValidatedConfig.ts';
import { prefixUserError } from '../portable/user-error-chaining.ts';
import { assertReadmesFitNpm, buildNpmReadme, type NpmReadme } from '../publish/assertReadmesFitNpm.ts';
import { assertReleasesOnNpm } from '../publish/assertReleasesOnNpm.ts';
import { assertTarballsComplete } from '../publish/assertTarballsComplete.ts';
import { describeEmptyWorkspace, discoverWorkspaces, type WorkspaceDiscovery } from '../targets/discoverWorkspaces.ts';
import {
  isSinglePackageTargets,
  PROJECT_TARGET_ID,
  type ResolvedReleaseTargets,
  resolveReleaseTargets,
  SINGLE_PACKAGE_TARGET_ID,
} from '../targets/resolveReleaseTargets.ts';
import type { ChangelogEntry, PackageTarget, ReleaseTarget, ReleaseType } from '../types.ts';
import { assertCleanWorkingTree } from './assertCleanWorkingTree.ts';
import { CANONICAL_SEMVER_PATTERN, parseSetVersions } from './prepare-args.ts';
import { prepareReleaseTargets, type TargetPrepareConfig, type TargetPrepareOptions } from './prepareReleaseTargets.ts';
import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './release-files.ts';
import { applyReleasePlan, type ReleasePlan } from './release-plan.ts';
import { reportPrepare } from './reportPrepare.ts';

/** A package target that a plan releases, with its release tag. */
interface ReleasedPackage {
  target: PackageTarget;
  tag: string;
}

/** Follows a failure to compute the release plan, which happens before `prepare` writes anything. */
const UNCHANGED_TREE_NOTE = 'The command did not write any files; the working tree is unchanged.';

export interface PrepareCommandOptions {
  bumpOverride: ReleaseType | undefined;
  configPath: string | undefined;
  isDryRun: boolean;
  /** The release targets that `--only` names, or `undefined` to release every target that has changes. */
  onlyNames: string[] | undefined;
  /** The raw `--set-version` value, whose accepted form depends on the mode. */
  setVersion: string | undefined;
  shouldForce: boolean;
  shouldIncludeReleaseNotes: boolean;
  shouldSkipGitChecks: boolean;
  styles: StreamStyles;
}

/**
 * Orchestrates the CLI `prepare` command: checks the working tree, loads and validates the config, discovers the
 * workspaces, and prepares the release over the targets of the repo shape.
 */
export async function prepareCommand(
  {
    bumpOverride,
    configPath,
    isDryRun,
    onlyNames,
    setVersion,
    shouldForce,
    shouldIncludeReleaseNotes,
    shouldSkipGitChecks,
    styles,
  }: PrepareCommandOptions,
  shell: Shell = realShell,
): Promise<void> {
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
    assertCleanWorkingTree();
  }

  const configResult = await loadValidatedConfig(configPath);
  if (configResult.status === 'invalid') {
    throw new ConfigProblemError(configResult.problem);
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
    throw prefixUserError('Failed to discover workspaces', error);
  }

  if (workspaceDiscovery.kind === 'empty') {
    throw new UserError(`No workspace package to release. ${describeEmptyWorkspace(workspaceDiscovery)}`);
  }

  const config = resolveSelectedTargets(userConfig, workspaceDiscovery, onlyNames, setVersion);
  const targetOptions: TargetPrepareOptions = {
    ...options,
    ...(onlyNames !== undefined && { onlyTargetIds: onlyNames }),
    ...(setVersion !== undefined && { versionOverridesById: resolveSetVersions(setVersion, config.targets) }),
  };
  runAndReport(
    () => {
      const plan = prepareReleaseTargets(config, targetOptions, realGit);
      const releasedPackages = findReleasedPackages(plan, config.targets);
      const releasedPackagePaths = releasedPackages.map(({ target }) => target.packagePath);
      assertReleasesOnNpm(releasedPackagePaths);
      assertReadmesFitNpm(buildPlannedNpmReadmes(plan, releasedPackages, config.settings, userConfig));
      assertTarballsComplete(releasedPackagePaths, userConfig?.devExportConditions ?? []);
      return plan;
    },
    isDryRun,
    styles.stdout,
    shell,
  );
}

// region | Helpers

/**
 * Builds the README that npm will receive for each released package, injecting the release's notes from the
 * `changelog.json` that the plan writes when injection is on: the file that `publish` reads once the release is
 * tagged.
 */
function buildPlannedNpmReadmes(
  plan: ReleasePlan,
  releasedPackages: readonly ReleasedPackage[],
  settings: TargetPrepareConfig['settings'],
  userConfig: ReleaseKitConfig | undefined,
): NpmReadme[] {
  const { releaseNotes, sectionOrder } = deriveReleaseNotesConfig(userConfig);
  return releasedPackages.flatMap(({ target, tag }) => {
    const entries = releaseNotes.shouldInjectIntoReadme
      ? findPlannedEntries(plan, resolveChangelogJsonPath(settings, target.changelogDir))
      : undefined;
    return buildNpmReadme(target.packagePath, entries, tag, sectionOrder) ?? [];
  });
}

/** Returns the changelog entries that the plan writes to a path, or `undefined` when it writes none readable there. */
function findPlannedEntries(plan: ReleasePlan, changelogJsonPath: string): ChangelogEntry[] | undefined {
  const write = plan.writes.find(({ path }) => path === changelogJsonPath);
  if (write === undefined) {
    return undefined;
  }
  const parsed = parseChangelogEntries(write.content);
  return parsed.status === 'loaded' ? parsed.entries : undefined;
}

/** Returns the package targets that a plan releases, each with its release tag, in target order. */
function findReleasedPackages(plan: ReleasePlan, targets: readonly ReleaseTarget[]): ReleasedPackage[] {
  const tagsById = new Map<string, string>();
  for (const result of plan.targets) {
    if (result.status === 'released' && result.kind === 'package') {
      tagsById.set(result.targetId, result.tag);
    }
  }
  return targets.flatMap((target) => {
    const tag = target.kind === 'package' ? tagsById.get(target.id) : undefined;
    return target.kind === 'package' && tag !== undefined ? { target, tag } : [];
  });
}

/** Returns the ids of the package and directory targets, which `--set-version` can name, in target order. */
function listMemberIds(targets: readonly ReleaseTarget[]): string[] {
  return targets.flatMap((target) => (target.kind === 'composite' ? [] : target.id));
}

/** Returns the ids of the targets that `--only` can name, in target order: all but a `project` block's composite. */
function listSelectableIds(targets: readonly ReleaseTarget[]): string[] {
  return targets.flatMap((target) => (target.id === PROJECT_TARGET_ID ? [] : target.id));
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

/**
 * Resolves the release targets of the discovered repo shape, checking `--only` and `--set-version` against them.
 * Throws a `UsageError` for a flag that the shape rejects or a name that it lacks. A monorepo's config-merge
 * error is rethrown with the `Failed to resolve workspaces` prefix; a single-package config-merge error propagates
 * unchanged.
 */
function resolveSelectedTargets(
  userConfig: ReleaseKitConfig | undefined,
  discovery: Exclude<WorkspaceDiscovery, { kind: 'empty' }>,
  onlyNames: string[] | undefined,
  setVersion: string | undefined,
): ResolvedReleaseTargets {
  if (discovery.kind === 'single-package') {
    if (onlyNames !== undefined) {
      throw new UsageError('--only is only supported for monorepo configurations');
    }
    if (setVersion !== undefined && !CANONICAL_SEMVER_PATTERN.test(setVersion)) {
      throw new UsageError(
        `Invalid --set-version value "${setVersion}". Must be canonical semver (N.N.N, no pre-release suffix).`,
      );
    }
    return resolveReleaseTargets(userConfig, discovery);
  }

  let config: ResolvedReleaseTargets;
  try {
    config = resolveReleaseTargets(userConfig, discovery);
  } catch (error: unknown) {
    throw prefixUserError('Failed to resolve workspaces', error);
  }

  // A project release derives its bump from the commits of every contributing workspace, and `prepare` doesn't accept
  // any flag that overrides the project version, so `--set-version`, which sets individual workspaces' versions, does
  // not compose with it.
  if (setVersion !== undefined && config.targets.some((target) => target.kind === 'composite')) {
    throw new UsageError(
      '--set-version cannot be combined with a project release. ' +
        "--set-version sets individual workspaces' versions; a project release rolls up every " +
        'contributing workspace. To use --set-version, run on a config without a `project` block or a `releases` composite.',
    );
  }

  const knownNames = listSelectableIds(config.targets);
  const requestedNames = onlyNames ?? [];
  for (const name of requestedNames) {
    if (knownNames.includes(name)) {
      continue;
    }

    throw new UsageError(`Unknown release target "${name}". Known targets: ${knownNames.join(', ')}`);
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

/**
 * Computes the release plan, applies it, runs the format command, and prints the report.
 *
 * The plan is applied before anything is printed, so a partially applied plan is never preceded
 * by a report that indicates success. The format command runs last because it rewrites the files
 * that the plan just wrote. Its failure leaves the release on disk and the tags file in place;
 * `release-kit commit` still proceeds.
 */
function runAndReport(computePlan: () => ReleasePlan, isDryRun: boolean, style: OutputStyle, shell: Shell): void {
  let plan: ReleasePlan;
  try {
    plan = computePlan();
  } catch (error: unknown) {
    if (isAnticipatedFailure(error)) {
      throw new UserError(`${error.message}\n${UNCHANGED_TREE_NOTE}`, { cause: error });
    }
    process.stderr.write(`${UNCHANGED_TREE_NOTE}\n`);
    throw error;
  }

  if (isDryRun) {
    process.stdout.write(reportPrepare(plan, { applied: false, style }) + '\n');
    reportPlanFiles(plan, true);
    return;
  }

  applyReleasePlan(plan);

  const formatError = runFormatCommand(plan.formatCommand, shell);

  process.stdout.write(
    reportPrepare(plan, { applied: true, style, ...(formatError !== undefined && { formatError }) }) + '\n',
  );
  reportPlanFiles(plan, false);

  if (formatError === undefined) {
    return;
  }

  throw new UserError(
    `The format command failed, but the release is prepared and ${RELEASE_TAGS_FILE} is written. ` +
      `Format the release files and run 'release-kit commit'.`,
  );
}

/**
 * Runs the plan's format command, returning its failure message if it fails.
 *
 * Never throws. By the time this runs the release is already on disk, so a formatting failure is
 * reported rather than allowed to undo it.
 */
function runFormatCommand(formatCommand: ReleasePlan['formatCommand'], shell: Shell): string | undefined {
  if (formatCommand === undefined) {
    return undefined;
  }

  try {
    shell.run(formatCommand.command);
    return undefined;
  } catch (error: unknown) {
    return describeError(error);
  }
}

// endregion | Helpers
