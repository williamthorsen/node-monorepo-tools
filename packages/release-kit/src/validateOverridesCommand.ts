import { formatErrorLine, formatStatusLine, type OutputStyle, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { buildChangelogEntries, type ReleaseHistoryConfig } from './buildChangelogEntries.ts';
import {
  type OverrideTargetItem,
  resolveOverridePath,
  validateAllChangelogOverrides,
  type ValidateAllChangelogOverridesInputs,
  type ValidateAllChangelogOverridesResult,
} from './changelogOverrides.ts';
import { describeEmptyWorkspace, discoverWorkspaces, type WorkspaceDiscovery } from './discoverWorkspaces.ts';
import { type GenerateChangelogOptions, getAllTagPrefixes } from './generateChangelogs.ts';
import { mergeMonorepoConfig, mergeSinglePackageConfig, readRootPackageVersion } from './loadConfig.ts';
import { type ConfigProblem, loadValidatedConfig, type LoadValidatedConfigResult } from './loadValidatedConfig.ts';
import type { ChangelogEntry, MonorepoReleaseConfig, ReleaseConfig, ReleaseKitConfig } from './types.ts';

/**
 * Synthetic unreleased-tag label passed to `buildChangelogEntries` during validation. The label
 * names the unreleased entry alone; the tag prefixes and paths decide which commits the windows
 * hold. `validate` persists nothing, so any non-empty string is acceptable — a clearly synthetic
 * literal aids debugging if the value ever surfaces.
 */
const SYNTHETIC_VALIDATE_TAG = 'validate-only';

/**
 * Result of {@link validateOverridesCommand}: tiered exit code paired with a human-readable
 * message, which keeps the CLI dispatch layer thin.
 *
 * Exit codes:
 * - `0` — clean: no errors, no warnings.
 * - `1` — only stale-key warnings.
 * - `2` — schema/parse errors or keys that fail to match (ambiguous prefix, overlapping keys, a bare key setting fields on several items) (errors dominate when both classes exist).
 */
export interface ValidateOverridesCommandResult {
  exitCode: 0 | 1 | 2;
  message: string;
}

/** Injection seams for unit testing. Production callers leave defaults; tests substitute deterministic fakes. */
export interface ValidateOverridesCommandDependencies {
  discoverWorkspaces?: () => WorkspaceDiscovery;
  loadValidatedConfig?: () => Promise<LoadValidatedConfigResult>;
  /**
   * Build changelog entries for a scope. Defaults to `buildChangelogEntries`, the same path
   * `release-kit prepare` uses — anchoring `validate`'s item universe to `prepare`'s by
   * construction.
   */
  buildEntries?: (config: ReleaseHistoryConfig, options: GenerateChangelogOptions) => ChangelogEntry[];
  /** Pluggable validator (default: the production library function). Tests use this to drive specific result shapes through the formatter. */
  validate?: (inputs: ValidateAllChangelogOverridesInputs) => ValidateAllChangelogOverridesResult;
}

/**
 * Validate every changelog override file across the project and per-workspace scopes, and
 * return a tiered exit-code-plus-message result. Performs workspace discovery, config load,
 * and per-scope item collection, then delegates the actual validation to
 * {@link validateAllChangelogOverrides}.
 *
 * Single-package and monorepo modes are handled uniformly: single-package collapses to one
 * project scope; monorepo expands to a project scope plus one scope per workspace. A workspace declaring
 * patterns that resolve to no package is neither, and exits `2`.
 *
 * `configPath` names the config file to read, relative to the working directory; it defaults to
 * `CONFIG_FILE_PATH`.
 */
export async function validateOverridesCommand(
  styles: StreamStyles,
  configPath?: string,
  dependencies: ValidateOverridesCommandDependencies = {},
): Promise<ValidateOverridesCommandResult> {
  const discover = dependencies.discoverWorkspaces ?? discoverWorkspaces;
  const load = dependencies.loadValidatedConfig ?? (() => loadValidatedConfig(configPath));
  const buildEntries = dependencies.buildEntries ?? defaultBuildEntries;
  const validate = dependencies.validate ?? validateAllChangelogOverrides;

  const configResult = await load();
  if (configResult.status === 'invalid') {
    return { exitCode: 2, message: formatConfigProblem(configResult.problem) };
  }
  const userConfig: ReleaseKitConfig | undefined = configResult.status === 'ok' ? configResult.config : undefined;

  let workspace: WorkspaceDiscovery;
  try {
    workspace = discover();
  } catch (error: unknown) {
    return { exitCode: 2, message: formatErrorLine(`Failed to discover workspaces: ${describeError(error)}`) };
  }

  if (workspace.kind === 'empty') {
    return {
      exitCode: 2,
      message: formatErrorLine(`No workspace package to validate. ${describeEmptyWorkspace(workspace)}`),
    };
  }

  let inputs: ValidateAllChangelogOverridesInputs;
  try {
    inputs =
      workspace.kind === 'single-package'
        ? buildSinglePackageInputs(userConfig, buildEntries)
        : buildMonorepoInputs(workspace.packageDirs, userConfig, buildEntries);
  } catch (error: unknown) {
    return { exitCode: 2, message: formatErrorLine(`Failed to resolve overrides scope: ${describeError(error)}`) };
  }

  const result = validate(inputs);
  // A message has glyphs only when its exit code is non-zero, and the entry point writes that one to stderr.
  return formatValidateOverridesResult(result, styles.stderr);
}

/**
 * Pure formatter — take an aggregated validation result, return the tiered exit code and a
 * rendered message. Exported for unit testing without going through the full discovery path.
 */
export function formatValidateOverridesResult(
  result: ValidateAllChangelogOverridesResult,
  style: OutputStyle,
): ValidateOverridesCommandResult {
  const { errors, warnings } = result;
  if (errors.length === 0 && warnings.length === 0) {
    return { exitCode: 0, message: 'All override files are valid (no errors, no stale keys).' };
  }

  const exitCode = errors.length > 0 ? 2 : 1;
  const summary = formatSummaryLine(errors.length, warnings.length);
  const errorLines = errors.map((message) => `  ${formatStatusLine(style, 'failed', message)}`);
  const warningLines = warnings.map((message) => `  ${formatStatusLine(style, 'warning', message)}`);
  const message = [summary, '', ...errorLines, ...warningLines].join('\n');
  return { exitCode, message };
}

/** Render the leading summary, omitting zero-count categories (e.g., `Found 1 warning:` rather than `Found 0 errors and 1 warning:`). */
function formatSummaryLine(errorCount: number, warningCount: number): string {
  const parts: string[] = [];
  if (errorCount > 0) {
    parts.push(pluralize(errorCount, 'error'));
  }
  if (warningCount > 0) {
    parts.push(pluralize(warningCount, 'warning'));
  }
  return `Found ${parts.join(' and ')}:`;
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? `${count} ${noun}` : `${count} ${noun}s`;
}

/** Delegates to `buildChangelogEntries`, which reads the release history as `prepare` does, under a throwaway tag label. */
function defaultBuildEntries(config: ReleaseHistoryConfig, options: GenerateChangelogOptions): ChangelogEntry[] {
  return buildChangelogEntries(config, SYNTHETIC_VALIDATE_TAG, options).entries;
}

/**
 * Project every release's items down to a flat list of hashes and entry positions. Synthetic propagation
 * entries (no `hash`) contribute nothing — they cannot match an override key.
 */
function flattenEntriesToItems(entries: readonly ChangelogEntry[]): OverrideTargetItem[] {
  const items: OverrideTargetItem[] = [];
  for (const entry of entries) {
    for (const section of entry.sections) {
      for (const { hash, entry: position } of section.items) {
        if (hash === undefined) continue;
        items.push(position === undefined ? { hash } : { hash, entry: position });
      }
    }
  }
  return items;
}

/**
 * Render an unusable config as this command's exit-2 message.
 *
 * A load failure is a failed operation and takes the error prefix; an invalid config is a verdict and is
 * surfaced bare. The kind picks the message shape alone: both abort.
 */
function formatConfigProblem(problem: ConfigProblem): string {
  return problem.kind === 'load'
    ? formatErrorLine(`Failed to load config: ${problem.message}`)
    : `Invalid config:\n  - ${problem.errors.join('\n  - ')}`;
}

/**
 * Build validation inputs for a single-package repo (no `pnpm-workspace.yaml`).
 *
 * Mirrors `releasePrepare.ts`'s `buildChangelogEntries` call: the configured tag prefix, and no
 * paths, so every release across all paths contributes.
 */
function buildSinglePackageInputs(
  userConfig: ReleaseKitConfig | undefined,
  buildEntries: NonNullable<ValidateOverridesCommandDependencies['buildEntries']>,
): ValidateAllChangelogOverridesInputs {
  const config: ReleaseConfig = mergeSinglePackageConfig(userConfig);
  const items = flattenEntriesToItems(buildEntries(config, { tagPrefixes: [config.tagPrefix] }));
  return {
    project: { filePath: resolveOverridePath('.'), items },
  };
}

/**
 * Build validation inputs for a monorepo, mirroring the per-scope item universes `prepare` would compute.
 *
 * Workspace scopes mirror `buildWorkspaceEntries` in `releasePrepareMono.ts`: the workspace's derived prefix plus any
 * legacy-identity prefixes, with the workspace's `paths`, routing change-record entries to the workspace's `dir`. The
 * project scope mirrors `planProjectChangelogs` in `releasePrepareProject.ts`: the project's tag prefix with the
 * resolved `project.paths`.
 */
function buildMonorepoInputs(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
  buildEntries: NonNullable<ValidateOverridesCommandDependencies['buildEntries']>,
): ValidateAllChangelogOverridesInputs {
  const rootPackage = readRootPackageVersion();
  const config: MonorepoReleaseConfig = mergeMonorepoConfig(discoveredPaths, userConfig, rootPackage);

  const workspaces = config.workspaces.map((workspace) => {
    const options = { tagPrefixes: getAllTagPrefixes(workspace), paths: workspace.paths, workspaceDir: workspace.dir };
    return {
      filePath: resolveOverridePath(workspace.workspacePath),
      items: flattenEntriesToItems(buildEntries(config, options)),
    };
  });

  const project = config.project;
  const projectScope: { filePath: string; items?: readonly OverrideTargetItem[] } = {
    filePath: resolveOverridePath('.'),
  };
  if (project !== undefined) {
    const options = { tagPrefixes: [project.tagPrefix], paths: project.paths };
    projectScope.items = flattenEntriesToItems(buildEntries(config, options));
  }

  return { project: projectScope, workspaces };
}
