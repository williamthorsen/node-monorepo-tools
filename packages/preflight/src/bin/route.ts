import process from 'node:process';

import { parseRunArgs, runCommand } from '../cli.ts';
import { compileCommand } from '../compile/compileCommand.ts';
import { initCommand } from '../init/initCommand.ts';

function showHelp(): void {
  console.info(`
Usage: preflight <command> [options]

Commands:
  run [names...]       Run preflight checklists
  compile [input]      Bundle TypeScript collection(s) into self-contained ESM file(s)
  init                 Scaffold a starter config and collection

Options:
  --help, -h       Show this help message
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
