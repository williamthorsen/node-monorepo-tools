/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

const VALID_BUMP_TYPES: readonly string[] = ['major', 'minor', 'patch'];

function isReleaseType(value: string): value is ReleaseType {
  return VALID_BUMP_TYPES.includes(value);
}

/** Display CLI usage information. */
function showHelp(): void {
  console.info(`
Usage: npx @williamthorsen/release-kit prepare [options]

Options:
  --dry-run             Run without modifying any files
  --bump=major|minor|patch  Override the bump type for all components
  --force               Bypass the "no commits since last tag" check (monorepo only, requires --bump)
  --only=name1,name2    Only process the named components (comma-separated, monorepo only)
  --help                Show this help message
`);
}

/** Parse CLI arguments into structured options. */
export function parseArgs(argv: string[]): {
  dryRun: boolean;
  force: boolean;
  bumpOverride: ReleaseType | undefined;
  only: string[] | undefined;
} {
  let dryRun = false;
  let force = false;
  let bumpOverride: ReleaseType | undefined;
  let only: string[] | undefined;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg.startsWith('--bump=')) {
      const value = arg.slice('--bump='.length);
      if (!isReleaseType(value)) {
        console.error(`Error: Invalid bump type "${value}". Must be one of: ${VALID_BUMP_TYPES.join(', ')}`);
        process.exit(1);
      }
      bumpOverride = value;
    } else if (arg.startsWith('--only=')) {
      const value = arg.slice('--only='.length);
      if (!value) {
        console.error('Error: --only requires a comma-separated list of component names');
        process.exit(1);
      }
      only = value.split(',');
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (force && bumpOverride === undefined) {
    console.error('Error: --force requires --bump to specify the version bump type');
    process.exit(1);
  }

  return { dryRun, force, bumpOverride, only };
}

/**
 * Write computed tags to the `.release-tags` file so the CI workflow can read them
 * instead of deriving tag names independently.
 */
export function writeReleaseTags(tags: string[], dryRun: boolean): void {
  if (tags.length === 0) {
    return;
  }

  if (dryRun) {
    console.info(dim(`  [dry-run] Would write ${RELEASE_TAGS_FILE}: ${tags.join(' ')}`));
    return;
  }

  mkdirSync(dirname(RELEASE_TAGS_FILE), { recursive: true });
  writeFileSync(RELEASE_TAGS_FILE, tags.join('\n'), 'utf8');
  console.info(dim(`  Wrote ${RELEASE_TAGS_FILE}: ${tags.join(' ')}`));
}

/**
 * Orchestrate the CLI `prepare` command.
 *
 * 1. Discovers workspaces from `pnpm-workspace.yaml`.
 * 2. Loads and validates `.config/release-kit.config.ts` (if present).
 * 3. Merges discovered defaults with user config.
 * 4. Delegates to `releasePrepare` or `releasePrepareMono`.
 * 5. Formats and prints the result via `reportPrepare`.
 * 6. Writes `.release-tags` for CI consumption.
 */
export async function prepareCommand(argv: string[]): Promise<void> {
  const { dryRun, force, bumpOverride, only } = parseArgs(argv);
  const options = {
    dryRun,
    force,
    ...(bumpOverride === undefined ? {} : { bumpOverride }),
  };

  if (dryRun) {
    console.info('\n🔍 DRY RUN — no files will be modified\n');
  }

  // 1. Load config file
  let rawConfig: unknown;
  try {
    rawConfig = await loadConfig();
  } catch (error: unknown) {
    console.error(`Error loading config: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // 2. Validate config
  let userConfig: ReleaseKitConfig | undefined;
  if (rawConfig !== undefined) {
    const { config, errors } = validateConfig(rawConfig);
    if (errors.length > 0) {
      console.error('Invalid config:');
      for (const err of errors) {
        console.error(`  ❌ ${err}`);
      }
      process.exit(1);
    }
    userConfig = config;
  }

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

/** Execute the prepare workflow, format the result, write to stdout, and handle errors. */
function runAndReport(execute: () => PrepareResult, dryRun: boolean): void {
  try {
    const result = execute();
    process.stdout.write(reportPrepare(result) + '\n');
    writeReleaseTags(result.tags, dryRun);

    if (result.tags.length > 0) {
      console.info(dim(`\n   Release tags file: ${RELEASE_TAGS_FILE}`));
    }
  } catch (error: unknown) {
    console.error('Error preparing release:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
