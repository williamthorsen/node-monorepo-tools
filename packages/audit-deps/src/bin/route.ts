import process from 'node:process';

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';

import { auditCommand, checkCommand, extractMessage, generateCommand, syncCommand } from '../cli.ts';
import { initCommand } from '../init/initCommand.ts';
import type { AuditScope, CommandOptions } from '../types.ts';
import { VERSION } from '../version.ts';

const SUBCOMMANDS = ['generate', 'init', 'sync'];
const MIN_PREFIX_LENGTH = 3;

function showHelp(): void {
  console.info(`
Usage: audit-deps [options]
       audit-deps <command> [options]

Commands:
  (default)            Grouped vulnerability check with severity indicators
  sync                 Synchronize allowlists with current audit findings
  generate             Regenerate flat audit-ci config files
  init                 Scaffold a starter config file

Scope options:
  --dev                Target dev dependencies only
  --prod               Target production dependencies only

Other options:
  --config <path>      Path to config file (default: .config/audit-deps.config.json)
  --json               Output results as JSON
  --raw                Run raw audit-ci passthrough
  --verbose, -v        Show detailed per-vulnerability output
  --help, -h           Show this help message
  --version, -V        Show version number
`);
}

function showInitHelp(): void {
  console.info(`
Usage: audit-deps init [options]

Scaffold a starter config file.

Options:
  --dry-run, -n   Preview changes without writing files
  --force, -f     Overwrite existing files
  --help, -h      Show this help message
`);
}

function showSyncHelp(): void {
  console.info(`
Usage: audit-deps sync [options]

Synchronize allowlists with current audit findings.

Scope options:
  --dev              Target dev dependencies only
  --prod             Target production dependencies only

Other options:
  --config <path>    Path to config file (default: .config/audit-deps.config.json)
  --json             Output results as JSON
  --help, -h         Show this help message
`);
}

function showGenerateHelp(): void {
  console.info(`
Usage: audit-deps generate [options]

Regenerate flat audit-ci config files.

Scope options:
  --dev              Target dev dependencies only
  --prod             Target production dependencies only

Other options:
  --config <path>    Path to config file (default: .config/audit-deps.config.json)
  --help, -h         Show this help message
`);
}

/** Parse the shared flags (--dev, --prod, --config, --json, --verbose) from argv. */
function parseSharedFlags(flags: string[]): CommandOptions {
  const flagSchema = {
    config: { long: '--config', type: 'string' as const },
    dev: { long: '--dev', type: 'boolean' as const },
    json: { long: '--json', type: 'boolean' as const, short: '-j' },
    prod: { long: '--prod', type: 'boolean' as const },
    verbose: { long: '--verbose', type: 'boolean' as const, short: '-v' },
  };

  const { flags: parsed } = parseArgs(flags, flagSchema);

  if (parsed.dev && parsed.prod) {
    throw new Error('Cannot specify both --dev and --prod');
  }

  const scopes: AuditScope[] = [];
  if (parsed.dev) scopes.push('dev');
  if (parsed.prod) scopes.push('prod');

  return {
    configPath: parsed.config,
    json: parsed.json,
    scopes,
    verbose: parsed.verbose,
  };
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

  if (command === '--help' || command === '-h') {
    showHelp();
    return 0;
  }

  if (command === '--version' || command === '-V') {
    console.info(VERSION);
    return 0;
  }

  if (command === 'init') {
    return handleInit(args.slice(1));
  }

  if (command === 'sync') {
    return handleSubcommand(args.slice(1), syncCommand, showSyncHelp);
  }

  if (command === 'generate') {
    return handleSubcommand(args.slice(1), generateCommand, showGenerateHelp);
  }

  // Check for typos before falling through to the default command
  if (command !== undefined && !command.startsWith('-')) {
    const typoMatch = findTypoMatch(command);
    if (typoMatch !== undefined) {
      process.stderr.write(`Error: Unknown command '${command}'. Did you mean 'audit-deps ${typoMatch}'?\n`);
      return 1;
    }
    process.stderr.write(`Error: Unknown command '${command}'.\n`);
    return 1;
  }

  // Handle --raw: strip it from args and route to auditCommand (raw passthrough).
  if (args.includes('--raw')) {
    const filteredArgs = args.filter((a) => a !== '--raw');
    return handleSubcommand(filteredArgs, auditCommand);
  }

  // Default (no args or flag-only args): grouped check command.
  return handleSubcommand(args, checkCommand);
}

/** Parse shared flags and dispatch to a subcommand handler. */
async function handleSubcommand(
  flags: string[],
  handler: (options: CommandOptions) => Promise<number>,
  helpFn: () => void = showHelp,
): Promise<number> {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    helpFn();
    return 0;
  }

  let options: CommandOptions;
  try {
    options = parseSharedFlags(flags);
  } catch (error: unknown) {
    process.stderr.write(`Error: ${translateParseError(error)}\n`);
    return 1;
  }

  try {
    return await handler(options);
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }
}

/** Handle the `init` subcommand with its own flag set. */
function handleInit(flags: string[]): number {
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
