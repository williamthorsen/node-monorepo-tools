/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import path from 'node:path';
import process from 'node:process';

import { readPackageVersion } from '@williamthorsen/nmr-core';

import { resolveContext } from './context.js';
import { generateHelp } from './help.js';
import type { ScriptRegistry } from './resolve-scripts.js';
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
    console.info(generateHelp(context.config, context.packageDir));
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

  const skipExitCode = handleSkipMessage(resolved.command, packageDir, parsed.quiet);
  if (skipExitCode !== undefined) {
    process.exit(skipExitCode);
  }

  if (resolved.source === 'package' && !parsed.quiet && registry[command] !== undefined) {
    console.info(`📦 ${path.basename(packageDir)}: Using override script: ${resolved.command}`);
  }

  const substitutedCommand = applyDevBin(resolved.command, context.config.devBin, context.monorepoRoot);
  const mainCommand = substitutedCommand + passthrough;

  // Hook recursion guard: commands ending in :pre or :post are leaf operations
  // and are not themselves wrapped in additional hook lookups.
  const isHookInvocation = command.endsWith(':pre') || command.endsWith(':post');
  const fullCommand = isHookInvocation ? mainCommand : wrapWithHooks(command, mainCommand, registry, packageDir);

  const code = runCommand(fullCommand, undefined, runOptions);
  process.exit(code);
}

/**
 * Returns the exit code to use when a resolved command is an explicit skip
 * (`""` or `":"`), printing the skip message unless quiet. Returns undefined
 * when the command is not a skip, indicating execution should proceed.
 */
function handleSkipMessage(resolvedCommand: string, packageDir: string, quiet: boolean): number | undefined {
  if (resolvedCommand === '') {
    if (!quiet) {
      console.info(`⛔ ${path.basename(packageDir)}: Override script is defined but empty. Skipping.`);
    }
    return 0;
  }
  if (resolvedCommand === ':') {
    if (!quiet) {
      console.info(`⛔ ${path.basename(packageDir)}: Override script is a no-op. Skipping.`);
    }
    return 0;
  }
  return undefined;
}

/**
 * Wraps a resolved main command with `nmr <command>:pre` and `nmr <command>:post`
 * invocations when the corresponding hooks resolve to non-skip values.
 *
 * Hooks are looked up via the same 3-tier registry as the main command. Missing
 * hooks (and explicit `""`/`":"` skips) are silent — they do not appear in the
 * chain and produce no output. Hook failure short-circuits the chain via shell
 * `&&` semantics; the failing exit code propagates.
 */
function wrapWithHooks(command: string, mainCommand: string, registry: ScriptRegistry, packageDir: string): string {
  const segments: string[] = [];

  if (hasRunnableHook(`${command}:pre`, registry, packageDir)) {
    segments.push(`nmr ${command}:pre`);
  }
  segments.push(mainCommand);
  if (hasRunnableHook(`${command}:post`, registry, packageDir)) {
    segments.push(`nmr ${command}:post`);
  }

  return segments.join(' && ');
}

/**
 * Returns true when a hook script resolves to a runnable command.
 * A hook is runnable when it resolves and the resolved value is neither
 * `""` nor `":"` (both of which mean "skip").
 */
function hasRunnableHook(hookName: string, registry: ScriptRegistry, packageDir: string): boolean {
  const resolved = resolveScript(hookName, registry, packageDir);
  if (!resolved) return false;
  return resolved.command !== '' && resolved.command !== ':';
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
