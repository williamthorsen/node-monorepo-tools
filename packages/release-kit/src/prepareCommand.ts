/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { loadConfig, mergeMonorepoConfig, mergeSinglePackageConfig } from './loadConfig.ts';
import { releasePrepare } from './releasePrepare.ts';
import { releasePrepareMono } from './releasePrepareMono.ts';
import { parseArgs, RELEASE_TAGS_FILE, writeReleaseTags } from './runReleasePrepare.ts';
import type { ReleaseKitConfig } from './types.ts';
import { validateConfig } from './validateConfig.ts';

/**
 * Orchestrates the CLI `prepare` command.
 *
 * 1. Discovers workspaces from `pnpm-workspace.yaml`.
 * 2. Loads and validates `.config/release-kit.config.ts` (if present).
 * 3. Merges discovered defaults with user config.
 * 4. Delegates to `releasePrepare` or `releasePrepareMono`.
 * 5. Writes `.release-tags` for CI consumption.
 */
export async function prepareCommand(argv: string[]): Promise<void> {
  const { dryRun, bumpOverride, only } = parseArgs(argv);
  const options = { dryRun, ...(bumpOverride === undefined ? {} : { bumpOverride }) };

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
        console.error(`  - ${err}`);
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

  // 4. Determine mode and merge config
  let tags: string[] = [];

  if (discoveredPaths === undefined) {
    // Single-package mode
    if (only !== undefined) {
      console.error('Error: --only is only supported for monorepo configurations');
      process.exit(1);
    }

    const config = mergeSinglePackageConfig(userConfig);

    try {
      tags = releasePrepare(config, options);
      writeReleaseTags(tags, dryRun);
    } catch (error: unknown) {
      console.error('Error preparing release:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
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

    try {
      tags = releasePrepareMono(config, options);
      writeReleaseTags(tags, dryRun);
    } catch (error: unknown) {
      console.error('Error preparing release:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  if (tags.length > 0) {
    console.info(`\nRelease tags file: ${RELEASE_TAGS_FILE}`);
  }
}
