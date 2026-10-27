import process from 'node:process';

import { parseArgs, reportError, resolveSelfVersion, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { auditCommand, checkCommand, syncCommand } from '../cli.ts';
import { initCommand } from '../init/initCommand.ts';
import { updateTemplatesCommand } from '../init/updateTemplatesCommand.ts';
import { OUTPUT_STYLE_ENV_VAR, resolveStyles } from '../resolveStyles.ts';
import type { AuditScope, CommandOptions } from '../types.ts';

const VERSION = resolveSelfVersion(import.meta.url);

const SUBCOMMANDS = ['check', 'init', 'sync', 'update-templates'];
const MIN_PREFIX_LENGTH = 3;

/** Prints the top-level usage. */
function showHelp(): void {
  console.info(`
Usage: v11y [options]
       v11y <command> [options]

Commands:
  check (default)      Grouped vulnerability check with severity indicators
  sync                 Synchronize allowlists with current audit findings
  init                 Scaffold a starter config file and GitHub Actions workflow
  update-templates     Update the scaffolded workflow to the current template

Scope options:
  --dev                Target dev dependencies only
  --prod               Target production dependencies only

Other options:
  --config <path>      Path to config file (default: .config/v11y-check.config.json)
  --json               Output results as JSON
  --raw                Run raw audit-ci passthrough
  --verbose, -v        Show detailed per-vulnerability output
  --help, -h           Show this help message
  --version, -V        Show version number

Environment:
  ${OUTPUT_STYLE_ENV_VAR}
                       Output style: auto (default), plain, or rich. auto prints plain,
                       without emoji, when CI is set or the stream is not a terminal.
`);
}

/** Prints the usage of `v11y init`. */
function showInitHelp(): void {
  console.info(`
Usage: v11y init [options]

Scaffold a starter config file and GitHub Actions workflow.

Options:
  --dry-run, -n   Preview changes without writing files
  --force, -f     Overwrite an existing workflow (an existing config is never overwritten)
  --help, -h      Show this help message
`);
}

/** Prints the usage of `v11y sync`. */
function showSyncHelp(): void {
  console.info(`
Usage: v11y sync [options]

Synchronize allowlists with current audit findings.

Scope options:
  --dev              Target dev dependencies only
  --prod             Target production dependencies only

Other options:
  --config <path>    Path to config file (default: .config/v11y-check.config.json)
  --json             Output results as JSON
  --help, -h         Show this help message
`);
}

/** Prints the usage of `v11y update-templates`. */
function showUpdateTemplatesHelp(): void {
  console.info(`
Usage: v11y update-templates [options]

Update .github/workflows/audit.yaml to the template of the installed version,
showing what changed. Creates the workflow when it is missing. Never touches
the config file.

Options:
  --dry-run, -n   Preview changes without writing files
  --help, -h      Show this help message
`);
}

/** Parses the flags shared by every subcommand but `init`. */
function parseSharedFlags(flags: string[], styles: StreamStyles): CommandOptions {
  const flagSchema = {
    configPath: { long: '--config', type: 'string' as const },
    isDev: { long: '--dev', type: 'boolean' as const },
    isJson: { long: '--json', type: 'boolean' as const, short: '-j' },
    isProd: { long: '--prod', type: 'boolean' as const },
    verbose: { long: '--verbose', type: 'boolean' as const, short: '-v' },
  };

  const { flags: parsedFlags } = parseArgs(flags, flagSchema);

  if (parsedFlags.isDev && parsedFlags.isProd) {
    throw new Error('Cannot specify both --dev and --prod');
  }

  const scopes: AuditScope[] = [];
  if (parsedFlags.isDev) scopes.push('dev');
  if (parsedFlags.isProd) scopes.push('prod');

  return {
    configPath: parsedFlags.configPath,
    isJson: parsedFlags.isJson,
    scopes,
    styles,
    verbose: parsedFlags.verbose,
  };
}

/** Finds the subcommand that a positional argument abbreviates, if any. */
function findTypoMatch(input: string): string | undefined {
  if (input.length < MIN_PREFIX_LENGTH || input.startsWith('-')) {
    return undefined;
  }
  for (const subcommand of SUBCOMMANDS) {
    if (subcommand !== input && subcommand.startsWith(input)) {
      return subcommand;
    }
  }
  return undefined;
}

/**
 * Routes CLI arguments to the appropriate subcommand.
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

  const styles = resolveStyles({
    env: process.env,
    stderrIsTty: process.stderr.isTTY,
    stdoutIsTty: process.stdout.isTTY,
  });
  if (styles === undefined) {
    return 1;
  }

  if (command === 'check') {
    return handleSubcommand(args.slice(1), styles, checkCommand);
  }

  if (command === 'init') {
    return handleInit(args.slice(1), styles);
  }

  if (command === 'sync') {
    return handleSubcommand(args.slice(1), styles, syncCommand, showSyncHelp);
  }

  if (command === 'update-templates') {
    return handleUpdateTemplates(args.slice(1), styles);
  }

  // A positional argument that doesn't name a subcommand is an error, never input to the default command.
  if (command !== undefined && !command.startsWith('-')) {
    const typoMatch = findTypoMatch(command);
    if (typoMatch !== undefined) {
      reportError(`Unknown command '${command}'. Did you mean 'v11y ${typoMatch}'?`);
      return 1;
    }
    reportError(`Unknown command '${command}'.`);
    return 1;
  }

  if (args.includes('--raw')) {
    const filteredArgs = args.filter((a) => a !== '--raw');
    return handleSubcommand(filteredArgs, styles, auditCommand);
  }

  // Default (no args or flag-only args): grouped check command.
  return handleSubcommand(args, styles, checkCommand);
}

/** Parses shared flags and dispatches to a subcommand handler. */
async function handleSubcommand(
  flags: string[],
  styles: StreamStyles,
  runSubcommand: (options: CommandOptions) => Promise<number>,
  showSubcommandHelp: () => void = showHelp,
): Promise<number> {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showSubcommandHelp();
    return 0;
  }

  let options: CommandOptions;
  try {
    options = parseSharedFlags(flags, styles);
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }

  try {
    return await runSubcommand(options);
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }
}

/** Handles the `init` subcommand with its own flag set. */
function handleInit(flags: string[], styles: StreamStyles): number {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showInitHelp();
    return 0;
  }

  const initFlagSchema = {
    isDryRun: { long: '--dry-run', type: 'boolean' as const, short: '-n' },
    shouldForce: { long: '--force', type: 'boolean' as const, short: '-f' },
  };

  let parsedArgs;
  try {
    parsedArgs = parseArgs(flags, initFlagSchema);
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }

  return initCommand({ isDryRun: parsedArgs.flags.isDryRun, shouldForce: parsedArgs.flags.shouldForce, styles });
}

/** Handles the `update-templates` subcommand with its own flag set. */
function handleUpdateTemplates(flags: string[], styles: StreamStyles): number {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showUpdateTemplatesHelp();
    return 0;
  }

  const updateTemplatesFlagSchema = {
    isDryRun: { long: '--dry-run', type: 'boolean' as const, short: '-n' },
  };

  let parsedArgs;
  try {
    parsedArgs = parseArgs(flags, updateTemplatesFlagSchema);
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }

  return updateTemplatesCommand({ isDryRun: parsedArgs.flags.isDryRun, styles });
}
