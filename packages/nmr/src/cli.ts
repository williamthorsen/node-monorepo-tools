/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import path from 'node:path';
import process from 'node:process';

import { readPackageVersion } from '@williamthorsen/nmr-core';

import { resolveContext } from './context.js';
import { generateHelp } from './help.js';
import { applyDevBin, buildRootRegistry, buildWorkspaceRegistry, resolveScript } from './resolver.js';
import { runCommand } from './runner.js';

const VERSION = readPackageVersion(import.meta.url);

/**
 * Shell-escapes a single argument by wrapping in single quotes
 * and escaping any embedded single quotes.
 */
function shellQuote(arg: string): string {
  return "'" + arg.replace(/'/g, String.raw`'\''`) + "'";
}

interface ParsedArgs {
  filter?: string;
  quiet: boolean;
  recursive: boolean;
  workspaceRoot: boolean;
  help: boolean;
  version: boolean;
  intTest: boolean;
  command?: string;
  passthrough: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    quiet: false,
    recursive: false,
    workspaceRoot: false,
    help: false,
    version: false,
    intTest: false,
    passthrough: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) break;

    if (arg === '-F' || arg === '--filter') {
      i++;
      const filterValue = args[i];
      if (filterValue === undefined) {
        console.error('Error: -F/--filter requires a pattern argument');
        process.exit(1);
      }
      result.filter = filterValue;
      i++;
      continue;
    }
    if (arg === '-R' || arg === '--recursive') {
      result.recursive = true;
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--workspace-root') {
      result.workspaceRoot = true;
      i++;
      continue;
    }
    if (arg === '-?' || arg === '--help') {
      result.help = true;
      i++;
      continue;
    }
    if (arg === '-V' || arg === '--version') {
      result.version = true;
      i++;
      continue;
    }
    if (arg === '-q' || arg === '--quiet') {
      result.quiet = true;
      i++;
      continue;
    }
    if (arg === '--int-test') {
      result.intTest = true;
      i++;
      continue;
    }

    // First non-flag argument is the command; rest is passthrough
    result.command = arg;
    result.passthrough = args.slice(i + 1);
    break;
  }

  return result;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.version) {
    console.info(VERSION);
    process.exit(0);
  }

  const context = await resolveContext();

  if (parsed.help || !parsed.command) {
    console.info(generateHelp(context.config));
    process.exit(0);
  }

  const { command } = parsed;
  const passthrough = parsed.passthrough.length > 0 ? ' ' + parsed.passthrough.map(shellQuote).join(' ') : '';
  const runOptions = { quiet: parsed.quiet };

  // -F: delegate to pnpm --filter
  if (parsed.filter) {
    const delegateCmd = `pnpm --filter ${shellQuote(parsed.filter)} exec nmr ${command}${passthrough}`;
    const code = runCommand(delegateCmd, context.monorepoRoot, runOptions);
    process.exit(code);
  }

  // -R: delegate to pnpm --recursive
  if (parsed.recursive) {
    process.env.NMR_RUN_IF_PRESENT = '1';
    const delegateCmd = `pnpm --recursive exec nmr ${command}${passthrough}`;
    const code = runCommand(delegateCmd, context.monorepoRoot, runOptions);
    process.exit(code);
  }

  // Determine which registry to use
  const useRoot = parsed.workspaceRoot || context.isRoot;
  const registry = useRoot ? buildRootRegistry(context.config) : buildWorkspaceRegistry(context.config, parsed.intTest);

  const packageDir = context.packageDir ?? context.monorepoRoot;
  const resolved = resolveScript(command, registry, packageDir);

  if (!resolved) {
    if (process.env.NMR_RUN_IF_PRESENT === '1') {
      process.exit(0);
    }
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  const packageName = path.basename(packageDir);

  if (resolved.command === '') {
    if (!parsed.quiet) {
      console.info(`⛔ ${packageName}: Override script is defined but empty. Skipping.`);
    }
    process.exit(0);
  }

  if (resolved.command === ':') {
    if (!parsed.quiet) {
      console.info(`⛔ ${packageName}: Override script is a no-op. Skipping.`);
    }
    process.exit(0);
  }

  if (resolved.source === 'package' && !parsed.quiet && registry[command] !== undefined) {
    console.info(`📦 ${packageName}: Using override script: ${resolved.command}`);
  }

  const substitutedCommand = applyDevBin(resolved.command, context.config.devBin, context.monorepoRoot);
  const fullCommand = substitutedCommand + passthrough;
  const code = runCommand(fullCommand, undefined, runOptions);
  process.exit(code);
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
