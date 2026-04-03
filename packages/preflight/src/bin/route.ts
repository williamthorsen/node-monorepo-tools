import process from 'node:process';

import { parseRunArgs, runCommand } from '../cli.ts';
import { compileCommand } from '../compile/compileCommand.ts';
import { initCommand } from '../init/initCommand.ts';
import { VERSION } from '../version.ts';

const SUBCOMMANDS = ['compile', 'init'];
const MIN_PREFIX_LENGTH = 3;

function showHelp(): void {
  console.info(`
Usage: preflight [names...] [options]
       preflight <command> [options]

Commands:
  run [names...]       Run preflight checklists (default)
  compile [input]      Bundle TypeScript collection(s) into self-contained ESM file(s)
  init                 Scaffold a starter config and collection

Run options:
  --file <path>                      Path to a local collection file
  --github <org/repo[@ref]>          Fetch collection from a GitHub repository
  --url <url>                        Fetch collection from a URL
  --collection <name>                Collection name (default: "default")
  --json                             Output results as JSON
  --fail-on <severity>               Fail on this severity or above (error, warn, recommend)
  --report-on <severity>             Report this severity or above (error, warn, recommend)

Global options:
  --help, -h           Show this help message
  --version, -V        Show version number
`);
}

function showRunHelp(): void {
  console.info(`
Usage: preflight run [names...] [options]

Run preflight checklists. If no names are given, all checklists are run.

Collection source (mutually exclusive):
  --file <path>                      Path to a local collection file
  --github <org/repo[@ref]>          Fetch collection from a GitHub repository
  --url <url>                        Fetch collection from a URL

Options:
  --collection <name>                Collection name (default: "default")
  --json                             Output results as JSON
  --fail-on <severity>               Fail on this severity or above (error, warn, recommend)
  --report-on <severity>             Report this severity or above (error, warn, recommend)
  --help, -h                         Show this help message

Defaults to .config/preflight/collections/default.ts when no source is given.
`);
}

function showCompileHelp(): void {
  console.info(`
Usage: preflight compile [input] [options]

Bundle TypeScript collection(s) into self-contained ESM bundle(s).
When no input is given, compiles all sources from the config's srcDir to outDir.

Options:
  --output, -o <path>  Output file path (default: input with .ts replaced by .js)
  --help, -h           Show this help message
`);
}

function showInitHelp(): void {
  console.info(`
Usage: preflight init [options]

Scaffold a starter config and collection file.

Options:
  --dry-run     Preview changes without writing files
  --force       Overwrite existing files
  --help, -h    Show this help message
`);
}

/** Check whether a positional arg is a close prefix of a known subcommand. */
function findTypoMatch(input: string): string | undefined {
  if (input.length < MIN_PREFIX_LENGTH || input.startsWith('-')) {
    return undefined;
  }
  for (const cmd of SUBCOMMANDS) {
    if (cmd !== input && cmd.startsWith(input)) {
      return cmd;
    }
  }
  return undefined;
}

/**
 * Route CLI arguments to the appropriate subcommand.
 *
 * Returns a numeric exit code: 0 for success, 1 for errors.
 */
export async function routeCommand(args: string[]): Promise<number> {
  const command = args[0];

  if (command === undefined || command === '--help' || command === '-h') {
    showHelp();
    return 0;
  }

  if (command === '--version' || command === '-V') {
    console.info(VERSION);
    return 0;
  }

  if (command === 'run') {
    return handleRun(args.slice(1));
  }

  if (command === 'compile') {
    const flags = args.slice(1);
    if (flags.some((f) => f === '--help' || f === '-h')) {
      showCompileHelp();
      return 0;
    }
    return compileCommand(flags);
  }

  if (command === 'init') {
    const flags = args.slice(1);
    if (flags.some((f) => f === '--help' || f === '-h')) {
      showInitHelp();
      return 0;
    }

    const knownInitFlags = new Set(['--dry-run', '--force', '--help', '-h']);
    const unknownFlags = flags.filter((f) => !knownInitFlags.has(f));
    if (unknownFlags.length > 0) {
      process.stderr.write(`Error: Unknown option: ${unknownFlags[0]}\n`);
      return 1;
    }

    const dryRun = flags.includes('--dry-run');
    const force = flags.includes('--force');
    return initCommand({ dryRun, force });
  }

  // Check for typos before falling through to the default command
  const typoMatch = findTypoMatch(command);
  if (typoMatch !== undefined) {
    process.stderr.write(`Error: Unknown command '${command}'. Did you mean 'preflight ${typoMatch}'?\n`);
    return 1;
  }

  // Default: treat all args as `run` arguments
  return handleRun(args);
}

/** Parse and execute the `run` subcommand. */
async function handleRun(flags: string[]): Promise<number> {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showRunHelp();
    return 0;
  }

  let parsed: ReturnType<typeof parseRunArgs>;
  try {
    parsed = parseRunArgs(flags);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }

  return runCommand(parsed);
}
