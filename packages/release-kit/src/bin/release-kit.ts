#!/usr/bin/env node
/* eslint n/hashbang: off, n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';

import { commitCommand } from '../commitCommand.ts';
import { createGithubReleaseCommand } from '../createGithubReleaseCommand.ts';
import { initCommand } from '../init/initCommand.ts';
import { prepareCommand } from '../prepareCommand.ts';
import { publishCommand } from '../publishCommand.ts';
import { pushCommand } from '../pushCommand.ts';
import { generateCommand } from '../sync-labels/generateCommand.ts';
import { syncLabelsInitCommand } from '../sync-labels/initCommand.ts';
import { syncLabelsCommand } from '../sync-labels/syncCommand.ts';
import { tagCommand } from '../tagCommand.ts';
import { VERSION } from '../version.ts';

function showUsage(): void {
  console.info(`
Usage: release-kit <command> [options]

Commands:
  prepare          Run release preparation (auto-discovers workspaces)
  commit           Stage changes and create the release commit
  tag              Create annotated git tags from the tags file
  push             Push release commit and tags (one push per tag)
  publish          Publish packages with release tags on HEAD
  create-github-release  Create GitHub Releases from changelog.json for tags on HEAD
  init             Initialize release-kit in the current repository
  sync-labels      Manage GitHub label synchronization

Options:
  --dry-run     Preview changes without writing files
  --help, -h    Show this help message
`);
}

function showSyncLabelsHelp(): void {
  console.info(`
Usage: release-kit sync-labels <subcommand> [options]

Manage GitHub label synchronization via preset and custom label definitions.

Subcommands:
  init          Scaffold caller workflow and config, then generate labels
  generate      Regenerate .github/labels.yaml from config
  sync          Trigger the sync-labels workflow via gh CLI

Options:
  --help, -h    Show this help message
`);
}

function showSyncLabelsInitHelp(): void {
  console.info(`
Usage: release-kit sync-labels init [options]

Scaffold the sync-labels caller workflow and config file, auto-discover workspaces
for scope labels, then generate .github/labels.yaml.

Options:
  --dry-run     Preview changes without writing files
  --force       Overwrite existing files instead of skipping them
  --help, -h    Show this help message
`);
}

function showSyncLabelsGenerateHelp(): void {
  console.info(`
Usage: release-kit sync-labels generate

Regenerate .github/labels.yaml from .config/sync-labels.config.ts.

Options:
  --help, -h    Show this help message
`);
}

function showSyncLabelsSyncHelp(): void {
  console.info(`
Usage: release-kit sync-labels sync

Trigger the sync-labels GitHub Actions workflow via the gh CLI.

Options:
  --help, -h    Show this help message
`);
}

function showInitHelp(): void {
  console.info(`
Usage: release-kit init [options]

Initialize release-kit in the current repository.
By default, scaffolds only the GitHub Actions workflow file.

Options:
  --with-config   Also scaffold .config/release-kit.config.ts and .config/git-cliff.toml
  --force         Overwrite existing files instead of skipping them
  --dry-run       Preview changes without writing files
  --help, -h      Show this help message
`);
}

function showPrepareHelp(): void {
  console.info(`
Usage: release-kit prepare [options]

Run release preparation with automatic workspace discovery.

Options:
  --dry-run             Run without modifying any files
  --bump=major|minor|patch  Override the bump type for all components
  --no-git-checks, -n   Skip the clean-working-tree check
  --only=name1,name2    Only process the named components (comma-separated, monorepo only)
  --help, -h            Show this help message
`);
}

function showCommitHelp(): void {
  console.info(`
Usage: release-kit commit [options]

Stage all changes and create the release commit using tags and summary
produced by \`prepare\`.

Options:
  --dry-run     Preview the commit message without creating it
  --help, -h    Show this help message
`);
}

function showTagHelp(): void {
  console.info(`
Usage: release-kit tag [options]

Create annotated git tags from the tags file produced by \`prepare\`.

Options:
  --dry-run          Preview without creating tags
  --no-git-checks    Skip dirty working tree check
  --help, -h         Show this help message
`);
}

function showPushHelp(): void {
  console.info(`
Usage: release-kit push [options]

Push the release commit and each tag individually, ensuring GitHub Actions
fires a separate workflow run per tag.

Options:
  --dry-run              Preview without pushing
  --only=name1,name2     Only push tags for the named packages (comma-separated, monorepo only)
  --tags-only            Skip the branch push (push tags only)
  --help, -h             Show this help message
`);
}

function showCreateGithubReleaseHelp(): void {
  console.info(`
Usage: release-kit create-github-release [options]

Create GitHub Releases from changelog.json for tags on HEAD.

Options:
  --dry-run              Preview without creating releases
  --tags=tag1,tag2       Only create releases for the named tags (comma-separated, full tag names)
  --help, -h             Show this help message
`);
}

function showPublishHelp(): void {
  console.info(`
Usage: release-kit publish [options]

Publish packages that have release tags on HEAD.

Options:
  --dry-run              Preview without publishing
  --no-git-checks        Skip git checks (pnpm only)
  --only=name1,name2     Only publish the named packages (comma-separated, monorepo only)
  --provenance           Generate provenance statement (requires OIDC, not supported by classic yarn)
  --help, -h             Show this help message
`);
}

const args = process.argv.slice(2);
const command = args[0];
const flags = args.slice(1);

if (command === '--version' || command === '-V') {
  console.info(VERSION);
  process.exit(0);
}

if (command === '--help' || command === '-h' || command === undefined) {
  showUsage();
  process.exit(0);
}

if (command === 'prepare') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showPrepareHelp();
    process.exit(0);
  }

  await prepareCommand(flags);
  process.exit(0);
}

if (command === 'commit') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showCommitHelp();
    process.exit(0);
  }

  try {
    commitCommand(flags);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'tag') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showTagHelp();
    process.exit(0);
  }

  tagCommand(flags);
  process.exit(0);
}

if (command === 'push') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showPushHelp();
    process.exit(0);
  }

  await pushCommand(flags);
  process.exit(0);
}

if (command === 'create-github-release') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showCreateGithubReleaseHelp();
    process.exit(0);
  }

  await createGithubReleaseCommand(flags);
  process.exit(0);
}

if (command === 'publish') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showPublishHelp();
    process.exit(0);
  }

  await publishCommand(flags);
  process.exit(0);
}

if (command === 'init') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showInitHelp();
    process.exit(0);
  }

  const initFlagSchema = {
    dryRun: { long: '--dry-run', type: 'boolean' as const },
    force: { long: '--force', type: 'boolean' as const },
    withConfig: { long: '--with-config', type: 'boolean' as const },
  };

  let parsed;
  try {
    parsed = parseArgs(flags, initFlagSchema);
  } catch (error: unknown) {
    console.error(`Error: ${translateParseError(error)}`);
    process.exit(1);
  }

  const { dryRun, force, withConfig } = parsed.flags;
  const exitCode = initCommand({ dryRun, force, withConfig });
  process.exit(exitCode);
}

if (command === 'sync-labels') {
  const subcommand = flags[0];
  const subflags = flags.slice(1);

  if (subcommand === '--help' || subcommand === '-h' || subcommand === undefined) {
    showSyncLabelsHelp();
    process.exit(0);
  }

  if (subcommand === 'init') {
    if (subflags.some((f) => f === '--help' || f === '-h')) {
      showSyncLabelsInitHelp();
      process.exit(0);
    }

    const syncLabelsInitFlagSchema = {
      dryRun: { long: '--dry-run', type: 'boolean' as const },
      force: { long: '--force', type: 'boolean' as const },
    };

    let syncParsed;
    try {
      syncParsed = parseArgs(subflags, syncLabelsInitFlagSchema);
    } catch (error: unknown) {
      console.error(`Error: ${translateParseError(error)}`);
      process.exit(1);
    }

    const { dryRun, force } = syncParsed.flags;
    const exitCode = await syncLabelsInitCommand({ dryRun, force });
    process.exit(exitCode);
  }

  if (subcommand === 'generate') {
    if (subflags.some((f) => f === '--help' || f === '-h')) {
      showSyncLabelsGenerateHelp();
      process.exit(0);
    }

    if (subflags.length > 0) {
      console.error(`Error: Unknown option: ${subflags[0]}`);
      process.exit(1);
    }

    const exitCode = await generateCommand();
    process.exit(exitCode);
  }

  if (subcommand === 'sync') {
    if (subflags.some((f) => f === '--help' || f === '-h')) {
      showSyncLabelsSyncHelp();
      process.exit(0);
    }

    if (subflags.length > 0) {
      console.error(`Error: Unknown option: ${subflags[0]}`);
      process.exit(1);
    }

    const exitCode = syncLabelsCommand();
    process.exit(exitCode);
  }

  console.error(`Error: Unknown subcommand: ${subcommand}`);
  showSyncLabelsHelp();
  process.exit(1);
}

console.error(`Error: Unknown command: ${command}`);
showUsage();
process.exit(1);
