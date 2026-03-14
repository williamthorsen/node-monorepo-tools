#!/usr/bin/env node
/* eslint n/hashbang: off, n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { initCommand } from '../init/initCommand.ts';
import { prepareCommand } from '../prepareCommand.ts';

function showUsage(): void {
  console.info(`
Usage: release-kit <command> [options]

Commands:
  prepare       Run release preparation (auto-discovers workspaces)
  init          Initialize release-kit in the current repository

Options:
  --dry-run     Preview changes without writing files
  --help, -h    Show this help message
`);
}

function showInitHelp(): void {
  console.info(`
Usage: release-kit init [options]

Initialize release-kit in the current repository.
Scaffolds workflow and config files.

Options:
  --dry-run     Preview changes without writing files
  --help, -h    Show this help message
`);
}

function showPrepareHelp(): void {
  console.info(`
Usage: release-kit prepare [options]

Run release preparation with automatic workspace discovery.

Options:
  --dry-run             Run without modifying any files
  --bump=major|minor|patch  Override the bump type for all components
  --only=name1,name2    Only process the named components (comma-separated, monorepo only)
  --help, -h            Show this help message
`);
}

const args = process.argv.slice(2);
const command = args[0];
const flags = args.slice(1);

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

if (command === 'init') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showInitHelp();
    process.exit(0);
  }

  const unknownFlags = flags.filter((f) => f !== '--dry-run' && f !== '--help' && f !== '-h');
  if (unknownFlags.length > 0) {
    console.error(`Error: Unknown option: ${unknownFlags[0]}`);
    process.exit(1);
  }

  const dryRun = flags.includes('--dry-run');
  const exitCode = await initCommand({ dryRun });
  process.exit(exitCode);
}

console.error(`Error: Unknown command: ${command}`);
showUsage();
process.exit(1);
