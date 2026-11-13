import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isRecord, reportError } from '@williamthorsen/nmr-core';
import { defineCommand, runCli, UsageError } from '@williamthorsen/nmr-core/cli';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { NMR_FMT_BIN } from '../bins.ts';
import { NO_CACHE_ENV_VAR } from '../check-cache/check-cache.ts';
import { readEnvSwitch } from '../env-switch.ts';
import { prepareFmtCache } from './fmt-cache.ts';
import {
  BROKEN_MANIFEST_FIX,
  findPackageManifest,
  type ManifestLookup,
  resolveDeclaredCli,
} from './package-manifest.ts';
import { resolveFormatTargets } from './resolveFormatTargets.ts';
import { resolveInheritedExitCode, type SpawnInherited, spawnInherited } from './spawn-inherited.ts';

const PRETTIER_PACKAGE = 'prettier';

/**
 * The house config, compiled beside this module's parent directory. The extension follows this module's own, so
 * that a run from source passes the `.ts` file, which Prettier loads under Node's type stripping.
 */
const DEFAULT_CONFIG_PATH = fileURLToPath(
  new URL(`../prettier-default.config${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url),
);

/**
 * Ceiling on the bytes of file arguments handed to one Prettier process, well under the smallest
 * `ARG_MAX` in play. Repositories below it run in a single process, which keeps the output to one
 * "Checking formatting..." banner; larger ones are split across further processes rather than failing.
 */
const ARGUMENT_BUDGET_BYTES = 100_000;

export type FormatMode = 'check' | 'write';

/** `--write` keeps `--list-different` so that a write run still names the files that it changed. */
const MODE_ARGS: Record<FormatMode, string[]> = {
  check: ['--check'],
  write: ['--list-different', '--write'],
};

/**
 * Runs `nmr-fmt` against `argv` and returns the exit code to report: It formats or checks the files that git
 * reports for `cwd`. A repository without a Prettier config of its own is formatted with the house config. The run
 * uses Prettier's content-keyed cache unless `--no-cache` or `NMR_NO_CACHE=1` bypasses it, and an `NMR_NO_CACHE`
 * that is neither on nor off is rejected as a usage error.
 *
 * Trailing arguments are git pathspecs, not Prettier flags; an unrecognized option is rejected rather
 * than passed along, since git would read it as a pathspec matching nothing and the run would report
 * success over an empty selection. Every argument after `--` is a pathspec, even one that starts
 * with `-`.
 */
export async function runFmt(
  argv: string[],
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const command = defineCommand({
    summary: 'Format or check the files that git lists',
    flags: {
      check: { type: 'boolean', description: 'Report the files that are not formatted, without changing them' },
      write: { type: 'boolean', description: 'Format the files in place, naming each one that changes' },
      noCache: { type: 'boolean', description: "Ignore Prettier's cache of files that already passed" },
    },
    operands: [{ name: 'pathspec', description: 'Git pathspecs that limit the files', optional: true, variadic: true }],
    run: ({ flags, operands }) => {
      if (flags.check === flags.write) {
        throw new UsageError(flags.check ? 'Pass --check or --write, not both.' : 'Pass --check or --write.');
      }
      const noCache = readEnvSwitch(env, NO_CACHE_ENV_VAR);
      if (!noCache.ok) {
        throw new UsageError(noCache.error);
      }

      return formatFiles(
        {
          mode: flags.check ? 'check' : 'write',
          pathspecs: operands.pathspec,
          shouldBypassCache: flags.noCache || noCache.isOn,
        },
        cwd,
        env,
      );
    },
  });

  return runCli(argv, command, { name: NMR_FMT_BIN, stdout: process.stdout, stderr: process.stderr, baseDir: cwd });
}

/** What one formatter run does, and the paths that it is limited to. */
interface FormatRequest {
  mode: FormatMode;
  pathspecs: string[];
  shouldBypassCache: boolean;
}

/** The copy of Prettier whose manifest a lookup reached, with the words that name it in an error. */
interface PrettierCopy {
  lookup: ManifestLookup;
  origin: string;
  reinstallStep: string;
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
  /** Runs the Prettier CLI on the caller's stdio. */
  spawn?: SpawnInherited;
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
    spawn = spawnInherited,
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
    // Keep Prettier from reading a file name that starts with `-` as a flag.
    '--',
  ];

  let firstFailureStatus = 0;

  for (const batch of batchWithinBudget(files, budgetBytes)) {
    const result = spawn(process.execPath, [...prettierArgs, ...batch], { cwd });

    if (result.error) {
      reportError(NMR_FMT_BIN, `could not run \`${PRETTIER_PACKAGE}\` (${result.error.message}).`);
      return 1;
    }

    const status = resolveInheritedExitCode(result);
    if (status !== 0 && firstFailureStatus === 0) {
      firstFailureStatus = status;
    }
  }

  return firstFailureStatus;
}

// region | Helpers

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
    const resolveConfigFile = isRecord(prettier) ? prettier['resolveConfigFile'] : undefined;
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

/** Formats or checks the files that git reports for `cwd`, as `runFmt` describes, and returns the exit code. */
async function formatFiles(request: FormatRequest, cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  const resolvedTargets = resolveFormatTargets(cwd, request.pathspecs);
  if (!resolvedTargets.ok) {
    reportError(NMR_FMT_BIN, resolvedTargets.error);
    return 1;
  }

  const { excludedFiles, files, ignorePaths, repositoryRoot, unreadableFiles } = resolvedTargets.targets;
  // Name each skipped path, so that a passing check does not hide the files that it never read.
  for (const { file, code } of unreadableFiles) {
    process.stderr.write(`nmr-fmt: skipped ${file}, which cannot be read (${code})\n`);
  }

  // Prettier run without file arguments would read stdin and fail, so an empty selection never reaches it.
  if (files.length === 0) {
    if (request.pathspecs.length === 0) return 0;

    // Pathspecs for which git listed nothing selected nothing, which a clean run would otherwise look exactly like.
    if (excludedFiles.length === 0 && unreadableFiles.length === 0) {
      reportError(NMR_FMT_BIN, `the pathspecs did not match any file that git lists: ${request.pathspecs.join(', ')}`);
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
    reportError(NMR_FMT_BIN, cli.error);
    return 1;
  }

  const repositoryConfig = await findRepositoryConfig(cli.manifestPath, cwd);
  if (!repositoryConfig.ok) {
    reportError(NMR_FMT_BIN, repositoryConfig.error);
    return 1;
  }

  const cache = prepareFmtCache({
    cwd,
    env,
    repositoryRoot,
    shouldBypassCache: request.shouldBypassCache,
  });
  // The cache only saves work, so a failure to prepare it must never fail the run.
  if (cache.kind === 'failed') {
    process.stderr.write(`nmr-fmt: running without the Prettier cache: ${cache.reason}\n`);
  }

  return runPrettier({
    cacheLocation: cache.kind === 'cached' ? cache.location : undefined,
    cliPath: cli.cliPath,
    configPath: repositoryConfig.found ? undefined : DEFAULT_CONFIG_PATH,
    mode: request.mode,
    files,
    ignorePaths,
    cwd,
  });
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

  // Only an absent repository copy gives way to nmr's, so that nmr's copy never formats in place of a broken one.
  const repositoryLookup = findPackageManifest(path.join(cwd, 'package.json'), PRETTIER_PACKAGE);
  const copy: PrettierCopy =
    repositoryLookup.kind === 'absent'
      ? {
          lookup: findPackageManifest(import.meta.url, PRETTIER_PACKAGE),
          origin: "nmr's installation",
          reinstallStep: 'Reinstall `@williamthorsen/nmr`.',
        }
      : {
          lookup: repositoryLookup,
          origin: 'this repository',
          reinstallStep: `Reinstall this repository's \`${PRETTIER_PACKAGE}\` dependency.`,
        };

  const { lookup } = copy;
  if (lookup.kind === 'absent') return missingResult;
  if (lookup.kind === 'broken') {
    return {
      ok: false,
      error: `\`${PRETTIER_PACKAGE}\` could not be loaded from ${copy.origin}: ${lookup.cause}. ${BROKEN_MANIFEST_FIX}`,
    };
  }

  const { manifest, manifestPath } = lookup;
  const cliPath = resolveDeclaredCli(manifest, manifestPath, PRETTIER_PACKAGE);
  if (cliPath === undefined) {
    return {
      ok: false,
      error: `\`${PRETTIER_PACKAGE}\` at ${path.dirname(manifestPath)} does not declare a CLI. ${copy.reinstallStep}`,
    };
  }

  return { ok: true, cliPath, manifestPath };
}

// endregion | Helpers
