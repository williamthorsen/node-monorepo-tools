import { formatErrorLine } from '@williamthorsen/nmr-core';

import { buildChangelogEntries } from './buildChangelogEntries.ts';
import {
  resolveOverridePath,
  validateAllChangelogOverrides,
  type ValidateAllChangelogOverridesInputs,
  type ValidateAllChangelogOverridesResult,
} from './changelogOverrides.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { buildTagPattern, type GenerateChangelogOptions, getAllTagPrefixes } from './generateChangelogs.ts';
import { loadConfig, mergeMonorepoConfig, mergeSinglePackageConfig, readRootPackageVersion } from './loadConfig.ts';
import type { ChangelogEntry, MonorepoReleaseConfig, ReleaseConfig, ReleaseKitConfig } from './types.ts';
import { validateConfig } from './validateConfig.ts';

/**
 * Synthetic `--tag` value passed to `buildChangelogEntries` during validation. Cliff uses the
 * tag only as a label for the unreleased range; the matching universe is determined by cliff's
 * history walk (filtered by `tagPattern`), not by this label. `validate` persists nothing, so
 * any non-empty string is acceptable — a clearly synthetic literal aids debugging if the value
 * ever surfaces.
 */
const SYNTHETIC_VALIDATE_TAG = 'validate-only';

/**
 * Result of {@link validateOverridesCommand}: tiered exit code paired with a human-readable
 * message. Mirrors the shape of `checkWorkTypesDrift` so the CLI dispatch layer can stay
 * uniformly thin.
 *
 * Exit codes:
 * - `0` — clean: no errors, no warnings.
 * - `1` — only stale-key warnings.
 * - `2` — schema/parse or ambiguous-prefix errors (errors dominate when both classes exist).
 */
export interface ValidateOverridesCommandResult {
  exitCode: 0 | 1 | 2;
  message: string;
}

/** Injection seams for unit testing. Production callers leave defaults; tests substitute deterministic fakes. */
export interface ValidateOverridesCommandDependencies {
  discoverWorkspaces?: () => Promise<string[] | undefined>;
  loadConfig?: () => Promise<unknown>;
  /**
   * Build changelog entries for a scope. Defaults to `buildChangelogEntries`, the same path
   * `release-kit prepare` uses — anchoring `validate`'s hash universe to `prepare`'s by
   * construction. `tagPattern` and `includePaths` are passed straight through to git-cliff.
   */
  buildEntries?: (
    config: Pick<ReleaseConfig, 'cliffConfigPath' | 'changelogJson'>,
    tagPattern?: string,
    includePaths?: string[],
  ) => ChangelogEntry[];
  /** Pluggable validator (default: the production library function). Tests use this to drive specific result shapes through the formatter. */
  validate?: (inputs: ValidateAllChangelogOverridesInputs) => ValidateAllChangelogOverridesResult;
}

/**
 * Validate every changelog override file across the project and per-workspace scopes, and
 * return a tiered exit-code-plus-message result. Performs workspace discovery, config load,
 * and per-scope hash collection, then delegates the actual validation to
 * {@link validateAllChangelogOverrides}.
 *
 * Single-package and monorepo modes are handled uniformly: single-package collapses to one
 * project scope; monorepo expands to a project scope plus one scope per workspace.
 */
export async function validateOverridesCommand(
  dependencies: ValidateOverridesCommandDependencies = {},
): Promise<ValidateOverridesCommandResult> {
  const discover = dependencies.discoverWorkspaces ?? discoverWorkspaces;
  const load = dependencies.loadConfig ?? loadConfig;
  const buildEntries = dependencies.buildEntries ?? defaultBuildEntries;
  const validate = dependencies.validate ?? validateAllChangelogOverrides;

  let rawConfig: unknown;
  try {
    rawConfig = await load();
  } catch (error: unknown) {
    return { exitCode: 2, message: formatErrorLine(`Failed to load config: ${errorMessage(error)}`) };
  }

  let userConfig: ReleaseKitConfig | undefined;
  try {
    // An invalid config is a verdict, not a failed operation — surfaced bare, unlike the load failure above.
    userConfig = validateLoadedConfig(rawConfig);
  } catch (error: unknown) {
    return { exitCode: 2, message: errorMessage(error) };
  }

  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discover();
  } catch (error: unknown) {
    return { exitCode: 2, message: formatErrorLine(`Failed to discover workspaces: ${errorMessage(error)}`) };
  }

  let inputs: ValidateAllChangelogOverridesInputs;
  try {
    inputs =
      discoveredPaths === undefined
        ? buildSinglePackageInputs(userConfig, buildEntries)
        : buildMonorepoInputs(discoveredPaths, userConfig, buildEntries);
  } catch (error: unknown) {
    return { exitCode: 2, message: formatErrorLine(`Failed to resolve overrides scope: ${errorMessage(error)}`) };
  }

  const result = validate(inputs);
  return formatValidateOverridesResult(result);
}

/**
 * Pure formatter — take an aggregated validation result, return the tiered exit code and a
 * rendered message. Exported for unit testing without going through the full discovery path.
 */
export function formatValidateOverridesResult(
  result: ValidateAllChangelogOverridesResult,
): ValidateOverridesCommandResult {
  const { errors, warnings } = result;
  if (errors.length === 0 && warnings.length === 0) {
    return { exitCode: 0, message: 'All override files are valid (no errors, no stale keys).' };
  }

  const exitCode = errors.length > 0 ? 2 : 1;
  const summary = formatSummaryLine(errors.length, warnings.length);
  const errorLines = errors.map((message) => `  ❌ ${message}`);
  const warningLines = warnings.map((message) => `  ⚠️  ${message}`);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Default entry builder — delegates to `buildChangelogEntries`, the same function `prepare`
 * uses. The synthetic tag label is throwaway; cliff's history walk is what produces the
 * matching universe.
 */
function defaultBuildEntries(
  config: Pick<ReleaseConfig, 'cliffConfigPath' | 'changelogJson'>,
  tagPattern?: string,
  includePaths?: string[],
): ChangelogEntry[] {
  // Build options conditionally — `exactOptionalPropertyTypes` distinguishes "omitted" from
  // "present-but-undefined", and `GenerateChangelogOptions` requires omission for the absent case.
  const options: GenerateChangelogOptions = {};
  if (tagPattern !== undefined) {
    options.tagPattern = tagPattern;
  }
  if (includePaths !== undefined) {
    options.includePaths = includePaths;
  }
  return buildChangelogEntries(config, SYNTHETIC_VALIDATE_TAG, options);
}

/**
 * Project every release's items down to a flat list of commit hashes. Synthetic propagation
 * entries (no `hash`) contribute nothing — they cannot match an override key.
 */
function flattenEntriesToHashes(entries: readonly ChangelogEntry[]): string[] {
  const hashes: string[] = [];
  for (const entry of entries) {
    for (const section of entry.sections) {
      for (const item of section.items) {
        if (item.hash !== undefined) {
          hashes.push(item.hash);
        }
      }
    }
  }
  return hashes;
}

/** Validate already-loaded config content, throwing an `Invalid config:` report on validation errors. */
function validateLoadedConfig(rawConfig: unknown): ReleaseKitConfig | undefined {
  if (rawConfig === undefined) {
    return undefined;
  }

  const { config, errors } = validateConfig(rawConfig);
  if (errors.length > 0) {
    throw new Error(`Invalid config:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

/**
 * Build validation inputs for a single-package repo (no `pnpm-workspace.yaml`).
 *
 * Mirrors `releasePrepare.ts`'s `buildChangelogEntries(config, newTag)` call: no
 * `tagPattern`/`includePaths`, letting cliff emit every release across all paths.
 */
function buildSinglePackageInputs(
  userConfig: ReleaseKitConfig | undefined,
  buildEntries: NonNullable<ValidateOverridesCommandDependencies['buildEntries']>,
): ValidateAllChangelogOverridesInputs {
  const config: ReleaseConfig = mergeSinglePackageConfig(userConfig);
  const hashes = flattenEntriesToHashes(buildEntries(config));
  return {
    project: { filePath: resolveOverridePath('.'), hashes },
  };
}

/**
 * Build validation inputs for a monorepo, mirroring the per-scope hash universes `prepare` would compute.
 *
 * Workspace scopes mirror `releasePrepareMono.ts:722-723`: `buildTagPattern` over the workspace's
 * derived prefix plus any legacy-identity prefixes, with the workspace's `includePaths`. The
 * project scope mirrors `releasePrepareProject.ts:262-266`: `buildTagPattern([project.tagPrefix])`
 * with the union of all workspace paths.
 */
function buildMonorepoInputs(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
  buildEntries: NonNullable<ValidateOverridesCommandDependencies['buildEntries']>,
): ValidateAllChangelogOverridesInputs {
  const rootPackage = readRootPackageVersion();
  const config: MonorepoReleaseConfig = mergeMonorepoConfig(discoveredPaths, userConfig, rootPackage);

  const workspaces = config.workspaces.map((workspace) => {
    const tagPattern = buildTagPattern(getAllTagPrefixes(workspace));
    return {
      filePath: resolveOverridePath(workspace.workspacePath),
      hashes: flattenEntriesToHashes(buildEntries(config, tagPattern, workspace.paths)),
    };
  });

  const project = config.project;
  const projectScope: { filePath: string; hashes?: readonly string[] } = {
    filePath: resolveOverridePath('.'),
  };
  if (project !== undefined) {
    const contributingPaths = config.workspaces.flatMap((workspace) => workspace.paths);
    const projectTagPattern = buildTagPattern([project.tagPrefix]);
    projectScope.hashes = flattenEntriesToHashes(buildEntries(config, projectTagPattern, contributingPaths));
  }

  return { project: projectScope, workspaces };
}
