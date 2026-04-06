import process from 'node:process';

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';

import { parseRunArgs, resolveCollectionSource, runCommand } from '../cli.ts';
import { compileCommand } from '../compile/compileCommand.ts';
import { initCommand } from '../init/initCommand.ts';
import { loadConfig } from '../loadConfig.ts';
import { VERSION } from '../version.ts';

const SUBCOMMANDS = ['compile', 'init'];
const MIN_PREFIX_LENGTH = 3;

/** Extract a displayable message from an unknown thrown value. */
function extractMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showHelp(): void {
  console.info(`
Usage: preflight [names...] [options]
       preflight <command> [options]

Commands:
  run [names...]       Run preflight checklists (default)
  compile [input]      Bundle TypeScript collection(s) into self-contained ESM file(s)
  init                 Scaffold a starter config and collection

Run options:
  --file, -f <path>                  Path to a local collection file
  --github, -g <org/repo[@ref]>      Fetch collection from a GitHub repository
  --local, -l <path>                 Load compiled collection from a local repository
  --url, -u <url>                    Fetch collection from a URL
  --collection, -c <name>            Collection name (default: "default")
  --json, -j                         Output results as JSON
  --fail-on, -F <severity>           Fail on this severity or above (error, warn, recommend)
  --report-on, -R <severity>         Report this severity or above (error, warn, recommend)

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
  --file, -f <path>                  Path to a local collection file
  --github, -g <org/repo[@ref]>      Fetch collection from a GitHub repository
  --local, -l <path>                 Load compiled collection from a local repository
  --url, -u <url>                    Fetch collection from a URL

Options:
  --collection, -c <name>            Collection name (default: "default")
  --json, -j                         Output results as JSON
  --fail-on, -F <severity>           Fail on this severity or above (error, warn, recommend)
  --report-on, -R <severity>         Report this severity or above (error, warn, recommend)
  --help, -h                         Show this help message

--collection accepts relative paths (e.g., --collection shared/deploy).
Defaults to .preflight/collections/default.ts when no source is given.
`);
}

function showCompileHelp(): void {
  console.info(`
Usage: preflight compile <file> [options]
       preflight compile --all

Bundle TypeScript collection(s) into self-contained ESM bundle(s).

Modes:
  preflight compile <file>           Compile a single file
  preflight compile --all, -a        Compile all sources from the config's srcDir

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
  --dry-run, -n   Preview changes without writing files
  --force, -f     Overwrite existing files
  --help, -h      Show this help message
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
    try {
      return await compileCommand(flags);
    } catch (error: unknown) {
      process.stderr.write(`Error: ${extractMessage(error)}\n`);
      return 1;
    }
  }

  if (command === 'init') {
    const flags = args.slice(1);
    if (flags.some((f) => f === '--help' || f === '-h')) {
      showInitHelp();
      return 0;
    }

    const initFlagSchema = {
      dryRun: { long: '--dry-run', type: 'boolean' as const, short: '-n' },
      force: { long: '--force', type: 'boolean' as const, short: '-f' },
    };

    let parsed;
    try {
      parsed = parseArgs(flags, initFlagSchema);
    } catch (error: unknown) {
      process.stderr.write(`Error: ${translateParseError(error)}\n`);
      return 1;
    }

    return initCommand({ dryRun: parsed.flags.dryRun, force: parsed.flags.force });
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
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }

  let config;
  try {
    config = await loadConfig();
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }

  let collectionSource;
  try {
    collectionSource = resolveCollectionSource({
      filePath: parsed.filePath,
      githubValue: parsed.githubValue,
      localValue: parsed.localValue,
      urlValue: parsed.urlValue,
      collectionName: parsed.collectionName,
      internalDir: config.internal.dir,
      internalExtension: config.internal.extension,
    });
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }

  return runCommand({
    collectionSource,
    json: parsed.json,
    names: parsed.names,
    ...(parsed.failOn !== undefined && { failOn: parsed.failOn }),
    ...(parsed.reportOn !== undefined && { reportOn: parsed.reportOn }),
  });
}
