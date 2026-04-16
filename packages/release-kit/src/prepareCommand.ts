/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import type { WriteResult } from '@williamthorsen/node-monorepo-core';
import {
  parseArgs as coreParseArgs,
  translateParseError,
  writeFileWithCheck,
} from '@williamthorsen/node-monorepo-core';

import { assertCleanWorkingTree } from './assertCleanWorkingTree.ts';
import { buildReleaseSummary } from './buildReleaseSummary.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { dim } from './format.ts';
import { loadConfig, mergeMonorepoConfig, mergeSinglePackageConfig } from './loadConfig.ts';
import { releasePrepare } from './releasePrepare.ts';
import { releasePrepareMono } from './releasePrepareMono.ts';
import { reportPrepare } from './reportPrepare.ts';
import type { PrepareResult, ReleaseKitConfig, ReleaseType } from './types.ts';
import { validateConfig } from './validateConfig.ts';

/**
 * File written by the release preparation step, containing one tag per line.
 * Relative to the project root so it works identically in CI and local runs.
 */
export const RELEASE_TAGS_FILE = 'tmp/.release-tags';

/**
 * File written by the release preparation step, containing the commit body summary.
 * Relative to the project root so it works identically in CI and local runs.
 */
export const RELEASE_SUMMARY_FILE = 'tmp/.release-summary';

const VALID_BUMP_TYPES: readonly string[] = ['major', 'minor', 'patch'];

function isReleaseType(value: string): value is ReleaseType {
  return VALID_BUMP_TYPES.includes(value);
}

/** Displays CLI usage information. */
function showHelp(): void {
  console.info(`
Usage: npx @williamthorsen/release-kit prepare [options]

Options:
  --dry-run             Run without modifying any files
  --bump=major|minor|patch  Override the bump type for all components
  --force               Force a release even when there are no commits since the last tag (requires --bump)
  --no-git-checks, -n   Skip the clean-working-tree check
  --only=name1,name2    Only process the named components (comma-separated, monorepo only)
  --help                Show this help message
`);
}

const prepareFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  force: { long: '--force', type: 'boolean' as const },
  noGitChecks: {
    long: '--no-git-checks',
    type: 'boolean' as const,
    short: '-n',
  },
  bump: { long: '--bump', type: 'string' as const },
  only: { long: '--only', type: 'string' as const },
  help: { long: '--help', type: 'boolean' as const, short: '-h' },
};

/** Parses CLI arguments into structured options. Throws on invalid input. */
export function parseArgs(argv: string[]): {
  dryRun: boolean;
  force: boolean;
  noGitChecks: boolean;
  bumpOverride: ReleaseType | undefined;
  only: string[] | undefined;
} {
  let parsed;
  try {
    parsed = coreParseArgs(argv, prepareFlagSchema);
  } catch (error: unknown) {
    throw new Error(translateParseError(error));
  }

  const { flags } = parsed;

  if (flags.help) {
    showHelp();
    process.exit(0);
  }

  let bumpOverride: ReleaseType | undefined;
  if (flags.bump !== undefined) {
    if (!isReleaseType(flags.bump)) {
      throw new Error(`Invalid bump type "${flags.bump}". Must be one of: ${VALID_BUMP_TYPES.join(', ')}`);
    }
    bumpOverride = flags.bump;
  }

  let only: string[] | undefined;
  if (flags.only !== undefined) {
    only = flags.only.split(',');
  }

  if (flags.force && bumpOverride === undefined) {
    throw new Error('--force requires --bump to specify the version bump type');
  }

  return {
    dryRun: flags.dryRun,
    force: flags.force,
    noGitChecks: flags.noGitChecks,
    bumpOverride,
    only,
  };
}

/**
 * Writes computed tags to the `.release-tags` file so the CI workflow can read them
 * instead of deriving tag names independently.
 */
export function writeReleaseTags(tags: string[], dryRun: boolean): WriteResult | undefined {
  if (tags.length === 0) {
    return undefined;
  }

  return writeFileWithCheck(RELEASE_TAGS_FILE, tags.join('\n'), {
    dryRun,
    overwrite: true,
  });
}

/**
 * Orchestrates the CLI `prepare` command.
 *
 * 1. Discovers workspaces from `pnpm-workspace.yaml`.
 * 2. Loads and validates `.config/release-kit.config.ts` (if present).
 * 3. Merges discovered defaults with user config.
 * 4. Delegates to `releasePrepare` or `releasePrepareMono`.
 * 5. Formats and prints the result via `reportPrepare`.
 * 6. Writes `.release-tags` for CI consumption.
 */
export async function prepareCommand(argv: string[]): Promise<void> {
  let dryRun: boolean;
  let force: boolean;
  let noGitChecks: boolean;
  let bumpOverride: ReleaseType | undefined;
  let only: string[] | undefined;
  try {
    ({ dryRun, force, noGitChecks, bumpOverride, only } = parseArgs(argv));
  } catch (error: unknown) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const options = {
    dryRun,
    force,
    ...(bumpOverride === undefined ? {} : { bumpOverride }),
  };

  if (dryRun) {
    console.info('\n🔍 DRY RUN — no files will be modified\n');
  }

  // Guard against running on a dirty working tree (skip for dry runs and --no-git-checks).
  if (!dryRun && !noGitChecks) {
    try {
      assertCleanWorkingTree();
    } catch (error: unknown) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  const userConfig = await loadAndValidateConfig();

  // 3. Discover workspaces
  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discoverWorkspaces();
  } catch (error: unknown) {
    console.error(`Error discovering workspaces: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // 4. Determine mode, merge config, and run
  if (discoveredPaths === undefined) {
    // Single-package mode
    if (only !== undefined) {
      console.error('Error: --only is only supported for monorepo configurations');
      process.exit(1);
    }

    const config = mergeSinglePackageConfig(userConfig);
    runAndReport(() => releasePrepare(config, options), dryRun);
  } else {
    // Monorepo mode
    const config = mergeMonorepoConfig(discoveredPaths, userConfig);

    if (only !== undefined) {
      const knownNames = config.components.map((c) => c.dir);

      // Validate all names before mutating config
      for (const name of only) {
        if (!knownNames.includes(name)) {
          console.error(`Error: Unknown component "${name}". Known components: ${knownNames.join(', ')}`);
          process.exit(1);
        }
      }

      config.components = config.components.filter((c) => only.includes(c.dir));
    }

    runAndReport(() => releasePrepareMono(config, options), dryRun);
  }
}

/** Loads and validate the release-kit config file, exiting on errors. */
async function loadAndValidateConfig(): Promise<ReleaseKitConfig | undefined> {
  let rawConfig: unknown;
  try {
    rawConfig = await loadConfig();
  } catch (error: unknown) {
    console.error(`Error loading config: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (rawConfig === undefined) {
    return undefined;
  }

  const { config, errors, warnings } = validateConfig(rawConfig);
  if (errors.length > 0) {
    console.error('Invalid config:');
    for (const err of errors) {
      console.error(`  ❌ ${err}`);
    }
    process.exit(1);
  }

  for (const warning of warnings) {
    console.warn(`  ⚠️  ${warning}`);
  }

  return config;
}

/** Executes the prepare workflow, format the result, write to stdout, and handle errors. */
function runAndReport(execute: () => PrepareResult, dryRun: boolean): void {
  let result: PrepareResult;
  try {
    result = execute();
  } catch (error: unknown) {
    console.error('Error preparing release:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  process.stdout.write(reportPrepare(result) + '\n');

  const writeResult = writeReleaseTags(result.tags, dryRun);

  if (writeResult?.outcome === 'failed') {
    console.error(`Error writing release tags: ${writeResult.error ?? 'unknown error'}`);
    process.exit(1);
  }

  if (writeResult) {
    if (dryRun) {
      console.info(dim(`  [dry-run] Would write ${RELEASE_TAGS_FILE}: ${result.tags.join(' ')}`));
    } else {
      console.info(dim(`  Wrote ${RELEASE_TAGS_FILE}: ${result.tags.join(' ')}`));
      console.info(dim(`\n   Release tags file: ${RELEASE_TAGS_FILE}`));
    }
  }

  // Writes the release summary file for the commit command.
  const summary = buildReleaseSummary(result);
  if (summary.length > 0) {
    const summaryResult = writeFileWithCheck(RELEASE_SUMMARY_FILE, summary, {
      dryRun,
      overwrite: true,
    });

    if (summaryResult.outcome === 'failed') {
      console.error(`Error writing release summary: ${summaryResult.error ?? 'unknown error'}`);
      process.exit(1);
    }

    if (dryRun) {
      console.info(dim(`  [dry-run] Would write ${RELEASE_SUMMARY_FILE}`));
    } else {
      console.info(dim(`  Wrote ${RELEASE_SUMMARY_FILE}`));
    }
  }

  if (writeResult && !dryRun) {
    console.error(`\nRun 'release-kit commit' to create the release commit.`);
  }
}
