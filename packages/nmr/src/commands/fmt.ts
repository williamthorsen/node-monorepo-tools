import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { isObject } from '../helpers/type-guards.ts';
import { prepareFmtCache } from './fmt-cache.ts';
import { resolveFormatTargets } from './format-targets.ts';

const PRETTIER_PACKAGE = 'prettier';

/**
 * The house config, compiled beside this module's parent directory. The extension follows this module's own, so
 * that a run from source passes the `.ts` file, which Prettier loads under Node's type stripping.
 */
const DEFAULT_CONFIG_PATH = fileURLToPath(
  new URL(`../prettier-default-config${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url),
);

/**
 * Ceiling on the bytes of file arguments handed to one Prettier process, well under the smallest
 * `ARG_MAX` in play. Repositories below it run in a single process, which keeps the output to one
 * "Checking formatting..." banner; larger ones are split across further processes rather than failing.
 */
const ARGUMENT_BUDGET_BYTES = 100_000;

const USAGE = 'Usage: nmr-fmt (--check | --write) [--no-cache] [pathspec...]';

export type FormatMode = 'check' | 'write';

/** `--write` keeps `--list-different` so that a write run still names the files that it changed. */
const MODE_ARGS: Record<FormatMode, string[]> = {
  check: ['--check'],
  write: ['--list-different', '--write'],
};

/**
 * Formats or checks the files that git reports for `cwd`, and returns the exit code to report. A repository
 * without a Prettier config of its own is formatted with the house config. The run uses Prettier's content-keyed
 * cache unless `--no-cache` or `NMR_NO_CACHE=1` bypasses it.
 *
 * Trailing arguments are git pathspecs, not Prettier flags; an unrecognized option is rejected rather
 * than passed along, since git would read it as a pathspec matching nothing and the run would report
 * success over an empty selection.
 */
export async function runFmt(argv: string[], cwd: string = process.cwd()): Promise<number> {
  const parsedArgs = parseFmtArgs(argv);
  if (!parsedArgs.ok) {
    reportError(`nmr-fmt: ${parsedArgs.error}`);
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }

  const resolvedTargets = resolveFormatTargets(cwd, parsedArgs.pathspecs);
  if (!resolvedTargets.ok) {
    reportError(`nmr-fmt: ${resolvedTargets.error}`);
    return 1;
  }

  const { excludedFiles, files, ignorePaths, repositoryRoot, unreadableFiles } = resolvedTargets.targets;
  // Name each skipped path, so that a passing check does not hide the files that it never read.
  for (const { file, code } of unreadableFiles) {
    process.stderr.write(`nmr-fmt: skipped ${file}, which cannot be read (${code})\n`);
  }

  // Prettier run without file arguments would read stdin and fail, so an empty selection never reaches it.
  if (files.length === 0) {
    if (parsedArgs.pathspecs.length === 0) return 0;

    // Pathspecs for which git listed nothing selected nothing, which a clean run would otherwise look exactly like.
    if (excludedFiles.length === 0 && unreadableFiles.length === 0) {
      reportError(`nmr-fmt: the pathspecs did not match any file that git lists: ${parsedArgs.pathspecs.join(', ')}`);
      return 1;
    }

    if (excludedFiles.length > 0) {
      process.stderr.write(
        `nmr-fmt: nothing to format; skipped paths that are not regular files: ${excludedFiles.join(', ')}\n`,
      );
    }
    return 0;
  }

  const cli = resolvePrettierCli(cwd);
  if (!cli.ok) {
    reportError(`nmr-fmt: ${cli.error}`);
    return 1;
  }

  const repositoryConfig = await findRepositoryConfig(cli.manifestPath, cwd);
  if (!repositoryConfig.ok) {
    reportError(`nmr-fmt: ${repositoryConfig.error}`);
    return 1;
  }

  const cache = prepareFmtCache({
    cwd,
    env: process.env,
    repositoryRoot,
    shouldBypassCache: parsedArgs.shouldBypassCache,
  });
  // The cache only saves work, so a failure to prepare it must never fail the run.
  if (cache.kind === 'failed') {
    process.stderr.write(`nmr-fmt: running without the Prettier cache: ${cache.reason}\n`);
  }

  return runPrettier({
    cacheLocation: cache.kind === 'cached' ? cache.location : undefined,
    cliPath: cli.cliPath,
    configPath: repositoryConfig.found ? undefined : DEFAULT_CONFIG_PATH,
    mode: parsedArgs.mode,
    files,
    ignorePaths,
    cwd,
  });
}

type ParseArgsResult =
  { ok: true; mode: FormatMode; pathspecs: string[]; shouldBypassCache: boolean } | { ok: false; error: string };

/** Reads the required mode flag and the optional cache bypass, and treats every remaining argument as a git pathspec. */
function parseFmtArgs(argv: string[]): ParseArgsResult {
  let mode: FormatMode | undefined;
  let shouldBypassCache = false;
  const pathspecs: string[] = [];

  for (const arg of argv) {
    if (arg === '--no-cache') {
      shouldBypassCache = true;
      continue;
    }
    if (arg === '--check' || arg === '--write') {
      const requestedMode: FormatMode = arg === '--check' ? 'check' : 'write';
      if (mode !== undefined && mode !== requestedMode) {
        return { ok: false, error: 'Pass --check or --write, not both.' };
      }
      mode = requestedMode;
      continue;
    }
    if (arg.startsWith('-')) {
      return { ok: false, error: `Unknown option: ${arg}` };
    }
    pathspecs.push(arg);
  }

  if (mode === undefined) {
    return { ok: false, error: 'Pass --check or --write.' };
  }

  return { ok: true, mode, pathspecs, shouldBypassCache };
}

/**
 * Locates the Prettier CLI, preferring the copy that `cwd` resolves over the one installed with nmr.
 *
 * A repository that installs its own Prettier gets that copy, so that the formatter is the one that its editor
 * and pre-commit hook also run: Another version would reformat files that the editor then reformats back. A
 * repository without one, such as one running nmr through `pnpm dlx`, gets nmr's own dependency. Resolution
 * goes through the module graph rather than PATH, because under pnpm's isolated layout the `prettier` first on
 * PATH need not be the one on which the repository depends.
 */
function resolvePrettierCli(
  cwd: string,
): { ok: true; cliPath: string; manifestPath: string } | { ok: false; error: string } {
  const missingResult = {
    ok: false as const,
    error: `\`${PRETTIER_PACKAGE}\` could not be resolved from this repository or from nmr's own installation, which declares it as a dependency. Reinstall \`@williamthorsen/nmr\`.`,
  };

  const manifestPath =
    resolveFrom(path.join(cwd, 'package.json'), `${PRETTIER_PACKAGE}/package.json`) ??
    resolveFrom(import.meta.url, `${PRETTIER_PACKAGE}/package.json`);
  if (manifestPath === undefined) return missingResult;

  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!isObject(manifest)) return missingResult;

  // Prettier declares a lone CLI, as a bare path in 3.x and as a named map in some releases.
  const bin = isObject(manifest['bin']) ? manifest['bin'][PRETTIER_PACKAGE] : manifest['bin'];
  if (typeof bin !== 'string') return missingResult;

  return { ok: true, cliPath: path.resolve(path.dirname(manifestPath), bin), manifestPath };
}

/**
 * Reports whether Prettier finds a config of its own searching from `cwd`, asking the copy that will format so
 * that discovery and formatting agree on which config forms count.
 */
async function findRepositoryConfig(
  manifestPath: string,
  cwd: string,
): Promise<{ ok: true; found: boolean } | { ok: false; error: string }> {
  try {
    const prettier: unknown = createRequire(manifestPath)(PRETTIER_PACKAGE);
    const resolveConfigFile = isObject(prettier) ? prettier['resolveConfigFile'] : undefined;
    if (typeof resolveConfigFile !== 'function') {
      return {
        ok: false,
        error: `\`${PRETTIER_PACKAGE}\` at ${path.dirname(manifestPath)} does not export \`resolveConfigFile\`.`,
      };
    }

    // Prettier searches from the directory containing the path, which need not exist.
    const configFile: unknown = await Reflect.apply(resolveConfigFile, undefined, [path.join(cwd, 'placeholder')]);
    return { ok: true, found: configFile !== null };
  } catch (error) {
    return { ok: false, error: `could not search for a Prettier config: ${describeError(error)}` };
  }
}

/** @internal */
export interface RunPrettierOptions {
  cliPath: string;
  /** Absolute path of the cache file to pass to Prettier; the run is uncached when it is absent. */
  cacheLocation?: string | undefined;
  /** Passed as `--config`, which replaces Prettier's own config discovery. */
  configPath?: string | undefined;
  mode: FormatMode;
  files: string[];
  ignorePaths: string[];
  cwd: string;
  /** Overridable so that the multi-batch path is reachable without a fixture that hits the real ceiling. */
  budgetBytes?: number;
}

/**
 * Runs Prettier over the selection, returning the first non-zero exit code. Every batch runs even after
 * one fails, so a check reports every offending file rather than only those in the first batch.
 *
 * Because the CLI runs under this process's own Node rather than through its shebang, it does not depend
 * on the file's execute bit or on PATH containing a `node`.
 *
 * @internal
 */
export function runPrettier(options: RunPrettierOptions): number {
  const {
    cacheLocation,
    cliPath,
    configPath,
    mode,
    files,
    ignorePaths,
    cwd,
    budgetBytes = ARGUMENT_BUDGET_BYTES,
  } = options;

  const prettierArgs = [
    cliPath,
    ...(configPath === undefined ? [] : ['--config', configPath]),
    // The file list contains types for which Prettier does not have a parser, ignore files and images among them.
    '--ignore-unknown',
    ...ignorePaths.flatMap((ignorePath) => ['--ignore-path', ignorePath]),
    ...(cacheLocation === undefined
      ? []
      : ['--cache', '--cache-strategy', 'content', '--cache-location', cacheLocation]),
    ...MODE_ARGS[mode],
  ];

  let firstFailureStatus = 0;

  for (const batch of batchWithinBudget(files, budgetBytes)) {
    const result = spawnSync(process.execPath, [...prettierArgs, ...batch], { cwd, stdio: 'inherit' });

    if (result.error) {
      reportError(`nmr-fmt: could not run \`${PRETTIER_PACKAGE}\` (${result.error.message}).`);
      return 1;
    }

    const status = result.status ?? 1;
    if (status !== 0 && firstFailureStatus === 0) {
      firstFailureStatus = status;
    }
  }

  return firstFailureStatus;
}

/** Groups paths into batches whose combined byte length stays within `budgetBytes`. */
function batchWithinBudget(files: string[], budgetBytes: number): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let sizeBytes = 0;

  for (const file of files) {
    // Count the separator that each argument adds alongside its own bytes.
    const costBytes = Buffer.byteLength(file) + 1;
    if (batch.length > 0 && sizeBytes + costBytes > budgetBytes) {
      batches.push(batch);
      batch = [];
      sizeBytes = 0;
    }
    batch.push(file);
    sizeBytes += costBytes;
  }

  if (batch.length > 0) batches.push(batch);

  return batches;
}

/** Resolves `specifier` as a module importing from `parent` would, or returns `undefined` when it cannot. */
function resolveFrom(parent: string, specifier: string): string | undefined {
  try {
    return createRequire(parent).resolve(specifier);
  } catch {
    return undefined;
  }
}
