/* eslint n/hashbang: off, n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import process from 'node:process';

import { parseRunArgs, runCommand } from '../cli.ts';
import { initCommand } from '../init/initCommand.ts';

function showHelp(): void {
  console.info(`
Usage: preflight <command> [options]

Commands:
  run [names...]   Run preflight checklists
  init             Scaffold a starter config file

Options:
  --help, -h       Show this help message
`);
}

function showRunHelp(): void {
  console.info(`
Usage: preflight run [names...] [options]

Run preflight checklists. If no names are given, all checklists are run.

Options:
  --config, -c <path>   Path to the config file
  --help, -h            Show this help message
`);
}

function showInitHelp(): void {
  console.info(`
Usage: preflight init [options]

Scaffold a starter .config/preflight.config.ts file.

Options:
  --dry-run     Preview changes without writing files
  --force       Overwrite an existing config file
  --help, -h    Show this help message
`);
}

const args = process.argv.slice(2);
const command = args[0];
const flags = args.slice(1);

if (command === '--help' || command === '-h' || command === undefined) {
  showHelp();
  process.exit(0);
}

if (command === 'run') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showRunHelp();
    process.exit(0);
  }

  let parsed: ReturnType<typeof parseRunArgs>;
  try {
    parsed = parseRunArgs(flags);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }

  const exitCode = await runCommand(parsed);
  process.exit(exitCode);
}

if (command === 'init') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showInitHelp();
    process.exit(0);
  }

  const knownInitFlags = new Set(['--dry-run', '--force', '--help', '-h']);
  const unknownFlags = flags.filter((f) => !knownInitFlags.has(f));
  if (unknownFlags.length > 0) {
    process.stderr.write(`Error: Unknown option: ${unknownFlags[0]}\n`);
    process.exit(1);
  }

  const dryRun = flags.includes('--dry-run');
  const force = flags.includes('--force');
  const exitCode = initCommand({ dryRun, force });
  process.exit(exitCode);
}

process.stderr.write(`Error: Unknown command: ${command}\n`);
showHelp();
process.exit(1);
