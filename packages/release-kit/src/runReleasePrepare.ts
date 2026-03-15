/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { releasePrepare } from './releasePrepare.ts';
import { releasePrepareMono } from './releasePrepareMono.ts';
import type { MonorepoReleaseConfig, ReleaseConfig, ReleaseType } from './types.ts';

/**
 * File written by the release preparation step, containing one tag per line.
 * Located in `/tmp` because it only needs to survive within a single CI job.
 */
export const RELEASE_TAGS_FILE = '/tmp/release-kit/.release-tags';

const VALID_BUMP_TYPES: readonly string[] = ['major', 'minor', 'patch'];

function isReleaseType(value: string): value is ReleaseType {
  return VALID_BUMP_TYPES.includes(value);
}

/** Check whether the config is a monorepo config by looking for the `components` property. */
function isMonorepoConfig(config: MonorepoReleaseConfig | ReleaseConfig): config is MonorepoReleaseConfig {
  return 'components' in config;
}

function showHelp(): void {
  console.info(`
Usage: runReleasePrepare [options]

Legacy entry point for release preparation. Prefer the CLI:
  npx @williamthorsen/release-kit prepare

Options:
  --dry-run             Run without modifying any files
  --bump=major|minor|patch  Override the bump type for all components
  --force               Bypass the "no commits since last tag" check (requires --bump)
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
 * CLI runner for release preparation that handles both monorepo and single-package configs.
 *
 * Parses `process.argv` for `--dry-run`, `--bump=<type>`, `--only=<names>`, and `--help`,
 * validates inputs against the provided config, and delegates to the appropriate handler.
 *
 * For monorepo configs (containing `components`), delegates to `releasePrepareMono`.
 * For single-package configs (containing `tagPrefix`), delegates to `releasePrepare`.
 * The `--only` flag is only valid with monorepo configs.
 *
 * Designed for CI use via `gh workflow run release.yaml`.
 *
 * @param config - A monorepo or single-package release configuration.
 */
export function runReleasePrepare(config: MonorepoReleaseConfig | ReleaseConfig): void {
  const { dryRun, force, bumpOverride, only } = parseArgs(process.argv.slice(2));
  const options = {
    dryRun,
    ...(force ? { force } : {}),
    ...(bumpOverride === undefined ? {} : { bumpOverride }),
  };

  if (!isMonorepoConfig(config)) {
    if (only !== undefined) {
      console.error('Error: --only is only supported for monorepo configurations');
      process.exit(1);
    }

    try {
      const tags = releasePrepare(config, options);
      writeReleaseTags(tags, dryRun);
    } catch (error: unknown) {
      console.error('Error preparing release:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    return;
  }

  let effectiveConfig = config;

  if (only !== undefined) {
    const knownNames = config.components.map((c) => c.dir);

    // Validate all names before computing filtered list
    for (const name of only) {
      if (!knownNames.includes(name)) {
        console.error(`Error: Unknown component "${name}". Known components: ${knownNames.join(', ')}`);
        process.exit(1);
      }
    }

    const filtered = config.components.filter((c) => only.includes(c.dir));

    effectiveConfig = { ...config, components: filtered };
  }

  try {
    const tags = releasePrepareMono(effectiveConfig, options);
    writeReleaseTags(tags, dryRun);
  } catch (error: unknown) {
    console.error('Error preparing release:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
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
    console.info(`  [dry-run] Would write ${RELEASE_TAGS_FILE}: ${tags.join(' ')}`);
    return;
  }

  mkdirSync(dirname(RELEASE_TAGS_FILE), { recursive: true });
  writeFileSync(RELEASE_TAGS_FILE, tags.join('\n'), 'utf8');
  console.info(`  Wrote ${RELEASE_TAGS_FILE}: ${tags.join(' ')}`);
}
