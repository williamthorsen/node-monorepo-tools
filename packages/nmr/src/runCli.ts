import path from 'node:path';
import type { Writable } from 'node:stream';

import { readPackageVersion, reportError } from '@williamthorsen/nmr-core';

import { resolveContext } from './context.ts';
import { generateHelp } from './help.ts';
import { isHookName } from './helpers/hook-name.ts';
import type { ScriptRegistry } from './resolve-scripts.ts';
import {
  applyDevBin,
  buildRootRegistry,
  buildWorkspaceRegistry,
  hasIntegrationTestConfig,
  resolveScript,
} from './resolver.ts';
import { runCommand } from './runner.ts';

const VERSION = readPackageVersion(import.meta.url);

/** @internal */
export interface RunCliOptions {
  /** Post-slice CLI arguments (equivalent to `process.argv.slice(2)`). */
  args: string[];
  /** Working directory used to resolve the nmr execution context. */
  cwd: string;
  /** Environment for `runCli` (used for `NMR_RUN_IF_PRESENT` reads and `-R` writes). */
  env: NodeJS.ProcessEnv;
  /** Stream for normal output (help text, override messages). */
  stdout: Writable;
  /** Stream for error output (unknown command, parse errors). */
  stderr: Writable;
}

/** @internal */
export interface RunCliResult {
  exitCode: number;
}

/**
 * Executes the nmr CLI flow in-process and returns the resulting exit code.
 * Holds no global state, reads no `process.*` globals, never calls `process.exit`.
 *
 * @internal
 */
export async function runCli(options: RunCliOptions): Promise<RunCliResult> {
  const { args, cwd, env, stdout, stderr } = options;

  const parseResult = parseArgs(args);
  if (!parseResult.ok) {
    reportError(parseResult.error, stderr);
    return { exitCode: 1 };
  }
  const { parsed } = parseResult;

  if (parsed.version) {
    stdout.write(`${VERSION}\n`);
    return { exitCode: 0 };
  }

  const context = await resolveContext(cwd);

  // Determine which registry to use
  const useRoot = parsed.workspaceRoot || context.isRoot;

  // Anchors registry resolution and execution alike: a script runs in the directory its registry belongs to.
  const anchorDir = useRoot ? context.monorepoRoot : (context.packageDir ?? context.monorepoRoot);

  if (parsed.help || !parsed.command) {
    stdout.write(`${generateHelp(context.config, anchorDir, useRoot)}\n`);
    return { exitCode: 0 };
  }

  const { command } = parsed;
  const passthrough = parsed.passthrough.length > 0 ? ' ' + parsed.passthrough.map(shellQuote).join(' ') : '';
  const runOptions = { quiet: parsed.quiet, stdout, stderr, env };

  // -F: delegate to pnpm --filter
  if (parsed.filter) {
    const delegateCmd = `pnpm --filter ${shellQuote(parsed.filter)} exec nmr ${command}${passthrough}`;
    const exitCode = runCommand(delegateCmd, context.monorepoRoot, runOptions);
    return { exitCode };
  }

  // -R: delegate to pnpm --recursive
  if (parsed.recursive) {
    const childEnv = { ...env, NMR_RUN_IF_PRESENT: '1' };
    const delegateCmd = `pnpm --recursive exec nmr ${command}${passthrough}`;
    const exitCode = runCommand(delegateCmd, context.monorepoRoot, { ...runOptions, env: childEnv });
    return { exitCode };
  }

  const registry = useRoot
    ? buildRootRegistry(context.config)
    : buildWorkspaceRegistry(context.config, hasIntegrationTestConfig(anchorDir));
  const resolved = resolveScript(command, registry, anchorDir, parsed.workspaceRoot);

  if (!resolved) {
    if (env.NMR_RUN_IF_PRESENT === '1') {
      return { exitCode: 0 };
    }
    reportError(`Unknown command: ${command}`, stderr);
    return { exitCode: 1 };
  }

  const skipExitCode = handleSkipMessage(resolved.command, anchorDir, parsed.quiet, stdout);
  if (skipExitCode !== undefined) {
    return { exitCode: skipExitCode };
  }

  if (resolved.source === 'package' && !parsed.quiet && registry[command] !== undefined) {
    stdout.write(`📦 ${path.basename(anchorDir)}: Using override script: ${resolved.command}\n`);
  }

  const substitutedCommand = applyDevBin(resolved.command, context.config.devBin, context.monorepoRoot);
  const mainCommand = substitutedCommand + passthrough;

  // Hook recursion guard: commands ending in :pre or :post are leaf operations
  // and are not themselves wrapped in additional hook lookups.
  const isHookInvocation = isHookName(command);
  const fullCommand = isHookInvocation
    ? mainCommand
    : wrapWithHooks(command, mainCommand, registry, anchorDir, parsed.workspaceRoot);

  const exitCode = runCommand(fullCommand, anchorDir, runOptions);
  return { exitCode };
}

/** @internal */
interface ParsedArgs {
  filter?: string;
  quiet: boolean;
  recursive: boolean;
  workspaceRoot: boolean;
  help: boolean;
  version: boolean;
  command?: string;
  passthrough: string[];
}

type ParseResult = { ok: true; parsed: ParsedArgs } | { ok: false; error: string };

function parseArgs(args: string[]): ParseResult {
  const parsed: ParsedArgs = {
    quiet: false,
    recursive: false,
    workspaceRoot: false,
    help: false,
    version: false,
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
        return { ok: false, error: '-F/--filter requires a pattern argument' };
      }
      parsed.filter = filterValue;
      i++;
      continue;
    }
    if (arg === '-R' || arg === '--recursive') {
      parsed.recursive = true;
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--workspace-root') {
      parsed.workspaceRoot = true;
      i++;
      continue;
    }
    if (arg === '-?' || arg === '--help') {
      parsed.help = true;
      i++;
      continue;
    }
    if (arg === '-V' || arg === '--version') {
      parsed.version = true;
      i++;
      continue;
    }
    if (arg === '-q' || arg === '--quiet') {
      parsed.quiet = true;
      i++;
      continue;
    }

    // First non-flag argument is the command; rest is passthrough
    parsed.command = arg;
    parsed.passthrough = args.slice(i + 1);
    break;
  }

  return { ok: true, parsed };
}

/**
 * Returns the exit code to use when a resolved command is an explicit skip
 * (`""` or `":"`), writing the skip message to `stdout` unless quiet. Returns
 * undefined when the command is not a skip, indicating execution should proceed.
 */
function handleSkipMessage(
  resolvedCommand: string,
  anchorDir: string,
  quiet: boolean,
  stdout: Writable,
): number | undefined {
  if (resolvedCommand === '') {
    if (!quiet) {
      stdout.write(`⛔ ${path.basename(anchorDir)}: Override script is defined but empty. Skipping.\n`);
    }
    return 0;
  }
  if (resolvedCommand === ':') {
    if (!quiet) {
      stdout.write(`⛔ ${path.basename(anchorDir)}: Override script is a no-op. Skipping.\n`);
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
 *
 * `-w` is propagated to hook subprocesses so each hook selects the root registry
 * on its own, independent of where the child derives its context from.
 */
function wrapWithHooks(
  command: string,
  mainCommand: string,
  registry: ScriptRegistry,
  anchorDir: string,
  workspaceRoot: boolean,
): string {
  const segments: string[] = [];
  const flag = workspaceRoot ? '-w ' : '';

  if (hasRunnableHook(`${command}:pre`, registry, anchorDir, workspaceRoot)) {
    segments.push(`nmr ${flag}${command}:pre`);
  }
  segments.push(mainCommand);
  if (hasRunnableHook(`${command}:post`, registry, anchorDir, workspaceRoot)) {
    segments.push(`nmr ${flag}${command}:post`);
  }

  return segments.join(' && ');
}

/**
 * Returns true when a hook script resolves to a runnable command.
 * A hook is runnable when it resolves and the resolved value is neither
 * `""` nor `":"` (both of which mean "skip").
 */
function hasRunnableHook(
  hookName: string,
  registry: ScriptRegistry,
  anchorDir: string,
  workspaceRoot: boolean,
): boolean {
  const resolved = resolveScript(hookName, registry, anchorDir, workspaceRoot);
  if (!resolved) return false;
  return resolved.command !== '' && resolved.command !== ':';
}

/**
 * Shell-escapes a single argument by wrapping in single quotes
 * and escaping any embedded single quotes.
 */
function shellQuote(arg: string): string {
  return "'" + arg.replace(/'/g, String.raw`'\''`) + "'";
}
