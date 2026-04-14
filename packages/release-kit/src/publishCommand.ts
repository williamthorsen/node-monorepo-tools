/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { basename } from 'node:path';

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';

import { createGithubReleases } from './createGithubRelease.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from './defaults.ts';
import { detectPackageManager } from './detectPackageManager.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { loadConfig } from './loadConfig.ts';
import { publish } from './publish.ts';
import { resolveReleaseTags } from './resolveReleaseTags.ts';
import { validateConfig } from './validateConfig.ts';

const publishFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  noGitChecks: { long: '--no-git-checks', type: 'boolean' as const },
  provenance: { long: '--provenance', type: 'boolean' as const },
  only: { long: '--only', type: 'string' as const },
};

/**
 * Orchestrate the CLI `publish` command: parse flags, discover workspaces, resolve tags from HEAD,
 * detect the package manager, validate `--only`, and delegate to `publish`.
 */
export async function publishCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs(argv, publishFlagSchema);
  } catch (error: unknown) {
    console.error(`Error: ${translateParseError(error)}`);
    process.exit(1);
  }

  const { dryRun, noGitChecks, provenance } = parsed.flags;
  const only = parsed.flags.only?.split(',');

  // Discover workspaces to determine single-package vs monorepo mode
  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discoverWorkspaces();
  } catch (error: unknown) {
    console.error(`Error discovering workspaces: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (only !== undefined && discoveredPaths === undefined) {
    console.error('Error: --only is only supported for monorepo configurations');
    process.exit(1);
  }

  // Build workspace map: dir (basename) -> workspace path
  const workspaceMap =
    discoveredPaths === undefined ? undefined : new Map(discoveredPaths.map((p) => [basename(p), p]));

  // Resolve tags from HEAD
  let resolvedTags = resolveReleaseTags(workspaceMap);

  if (resolvedTags.length === 0) {
    console.error('Error: No release tags found on HEAD. Create tags with `release-kit tag` first.');
    process.exit(1);
  }

  // Validate --only against resolved tags
  if (only !== undefined) {
    const availableNames = resolvedTags.map((t) => t.dir);
    for (const name of only) {
      if (!availableNames.includes(name)) {
        console.error(`Error: Unknown package "${name}" in --only. Available: ${availableNames.join(', ')}`);
        process.exit(1);
      }
    }
    resolvedTags = resolvedTags.filter((t) => only.includes(t.dir));
  }

  const packageManager = detectPackageManager();

  // Load config for releaseNotes and changelogJson settings.
  let releaseNotes = { ...DEFAULT_RELEASE_NOTES_CONFIG };
  let changelogJsonOutputPath = DEFAULT_CHANGELOG_JSON_CONFIG.outputPath;
  let rawConfig: unknown;
  try {
    rawConfig = await loadConfig();
  } catch (error: unknown) {
    console.warn(
      `Warning: failed to load config; using defaults: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (rawConfig !== undefined) {
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
    releaseNotes = {
      ...DEFAULT_RELEASE_NOTES_CONFIG,
      ...config.releaseNotes,
    };
    changelogJsonOutputPath = config.changelogJson?.outputPath ?? DEFAULT_CHANGELOG_JSON_CONFIG.outputPath;
  }

  try {
    publish(resolvedTags, packageManager, {
      dryRun,
      noGitChecks,
      provenance,
      releaseNotes,
      changelogJsonOutputPath,
    });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Create GitHub Releases after successful publish.
  createGithubReleases(resolvedTags, releaseNotes, changelogJsonOutputPath, dryRun);
}
