import process from 'node:process';

import { parseRunArgs, runCommand } from '../cli.ts';
import { compileCommand } from '../compile/compileCommand.ts';
import { initCommand } from '../init/initCommand.ts';

function showHelp(): void {
  console.info(`
Usage: preflight <command> [options]

Commands:
  run [names...]       Run preflight checklists
  compile <input>      Bundle a TypeScript config into a self-contained ESM file
  init                 Scaffold a starter config file

Options:
  --help, -h       Show this help message
`);
}

function showRunHelp(): void {
  console.info(`
Usage: preflight run [names...] [options]

Run preflight checklists. If no names are given, all checklists are run.

Config source (mutually exclusive):
  --config, -c <path>              Path to a local config file
  --github <org/repo/path[@ref]>   Fetch config from a GitHub repository
  --url <url>                      Fetch config from a URL

Options:
  --json                           Output results as JSON
  --help, -h                       Show this help message
`);
}

function showCompileHelp(): void {
  console.info(`
Usage: preflight compile <input> [options]

Bundle a TypeScript checklist file into a self-contained ESM bundle.

Options:
  --output, -o <path>  Output file path (default: input with .ts replaced by .js)
  --help, -h           Show this help message
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

/**
 * Route CLI arguments to the appropriate subcommand.
 *
 * Returns a numeric exit code: 0 for success, 1 for errors.
 */
export async function routeCommand(args: string[]): Promise<number> {
  const command = args[0];
  const flags = args.slice(1);

  if (command === '--help' || command === '-h' || command === undefined) {
    showHelp();
    return 0;
  }

  if (command === 'run') {
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

  if (command === 'compile') {
    if (flags.some((f) => f === '--help' || f === '-h')) {
      showCompileHelp();
      return 0;
    }

    return compileCommand(flags);
  }

  if (command === 'init') {
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

  process.stderr.write(`Error: Unknown command: ${command}\n`);
  showHelp();
  return 1;
}
