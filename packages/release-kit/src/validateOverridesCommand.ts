import {
  resolveOverridePath,
  validateAllChangelogOverrides,
  type ValidateAllChangelogOverridesInputs,
  type ValidateAllChangelogOverridesResult,
} from './changelogOverrides.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { loadConfig, mergeMonorepoConfig, mergeSinglePackageConfig, readRootPackageVersion } from './loadConfig.ts';
import type { MonorepoReleaseConfig, ReleaseConfig, ReleaseKitConfig } from './types.ts';
import { validateConfig } from './validateConfig.ts';

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
  /** Collect commit hashes for a given tag-prefix union and optional path filter. Defaults to a real `git log` invocation. */
  collectHashes?: (tagPrefixes: readonly string[], paths?: string[]) => readonly string[];
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
  const collect = dependencies.collectHashes ?? defaultCollectHashes;
  const validate = dependencies.validate ?? validateAllChangelogOverrides;

  let userConfig: ReleaseKitConfig | undefined;
  try {
    userConfig = await loadAndValidateConfig(load);
  } catch (error: unknown) {
    return { exitCode: 2, message: errorMessage(error) };
  }

  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discover();
  } catch (error: unknown) {
    return { exitCode: 2, message: `Error discovering workspaces: ${errorMessage(error)}` };
  }

  let inputs: ValidateAllChangelogOverridesInputs;
  try {
    inputs =
      discoveredPaths === undefined
        ? buildSinglePackageInputs(userConfig, collect)
        : buildMonorepoInputs(discoveredPaths, userConfig, collect);
  } catch (error: unknown) {
    return { exitCode: 2, message: `Error resolving overrides scope: ${errorMessage(error)}` };
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
  const summary = `Found ${pluralize(errors.length, 'error')} and ${pluralize(warnings.length, 'warning')}:`;
  const errorLines = errors.map((message) => `  ❌ ${message}`);
  const warningLines = warnings.map((message) => `  ⚠️  ${message}`);
  const message = [summary, '', ...errorLines, ...warningLines].join('\n');
  return { exitCode, message };
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? `${count} ${noun}` : `${count} ${noun}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Default hash collector — wraps `getCommitsSinceTarget` and projects to the hash list. */
function defaultCollectHashes(tagPrefixes: readonly string[], paths?: string[]): readonly string[] {
  if (tagPrefixes.length === 0) {
    return [];
  }
  return getCommitsSinceTarget(tagPrefixes, paths).commits.map((commit) => commit.hash);
}

/** Load and validate the user's config file, throwing a descriptive error on any problem. */
async function loadAndValidateConfig(load: () => Promise<unknown>): Promise<ReleaseKitConfig | undefined> {
  let rawConfig: unknown;
  try {
    rawConfig = await load();
  } catch (error: unknown) {
    throw new Error(`Error loading config: ${errorMessage(error)}`);
  }

  if (rawConfig === undefined) {
    return undefined;
  }

  const { config, errors } = validateConfig(rawConfig);
  if (errors.length > 0) {
    throw new Error(`Invalid config:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

/** Build validation inputs for a single-package repo (no `pnpm-workspace.yaml`). */
function buildSinglePackageInputs(
  userConfig: ReleaseKitConfig | undefined,
  collect: (tagPrefixes: readonly string[], paths?: string[]) => readonly string[],
): ValidateAllChangelogOverridesInputs {
  const config: ReleaseConfig = mergeSinglePackageConfig(userConfig);
  const hashes = [...collect([config.tagPrefix])];
  return {
    project: { filePath: resolveOverridePath('.'), hashes },
  };
}

/** Build validation inputs for a monorepo, mirroring the per-scope hash universes `prepare` would compute. */
function buildMonorepoInputs(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
  collect: (tagPrefixes: readonly string[], paths?: string[]) => readonly string[],
): ValidateAllChangelogOverridesInputs {
  const rootPackage = readRootPackageVersion();
  const config: MonorepoReleaseConfig = mergeMonorepoConfig(discoveredPaths, userConfig, rootPackage);

  const workspaces = config.workspaces.map((workspace) => {
    const tagPrefixes = [
      workspace.tagPrefix,
      ...(workspace.legacyIdentities?.map((identity) => identity.tagPrefix) ?? []),
    ];
    return {
      filePath: resolveOverridePath(workspace.workspacePath),
      hashes: [...collect(tagPrefixes, workspace.paths)],
    };
  });

  const project = config.project;
  const projectScope: { filePath: string; hashes?: readonly string[] } = {
    filePath: resolveOverridePath('.'),
  };
  if (project !== undefined) {
    const contributingPaths = config.workspaces.flatMap((workspace) => workspace.paths);
    projectScope.hashes = [...collect([project.tagPrefix], contributingPaths)];
  }

  return { project: projectScope, workspaces };
}
