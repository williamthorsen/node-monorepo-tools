import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';

import { isObject } from '../helpers/type-guards.ts';

/** The ignore file that Prettier reads but does not discover hierarchically. */
const IGNORE_FILENAME = '.prettierignore';

/**
 * Selects tracked files plus untracked files that git does not ignore, NUL-delimited so that paths
 * containing spaces or newlines stay intact. Untracked-but-unignored files are included so that a newly
 * created file is formatted before it is ever added to the index.
 */
const LIST_FILES_ARGS = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];

/**
 * Matches `.prettierignore` at every depth in one call: git pathspec wildcards cross `/`, so this
 * finds the repository-root file and every package-level one together. It also matches names like
 * `foo.prettierignore`, which the caller filters out by basename.
 */
const IGNORE_FILE_PATHSPEC = `*${IGNORE_FILENAME}`;

const PRETTIER_PACKAGE = 'prettier';

/** The peer range, quoted back to a consumer whose repository does not contain a resolvable Prettier. */
const PRETTIER_RANGE = '>=3.9.5 <4';

/**
 * Ceiling on the bytes of file arguments handed to one Prettier process, well under the smallest
 * `ARG_MAX` in play. Repositories below it run in a single process, which keeps the output to one
 * "Checking formatting..." banner; larger ones are split across further processes rather than failing.
 */
const ARGUMENT_BUDGET_BYTES = 100_000;

const USAGE = 'Usage: nmr-fmt (--check | --write) [pathspec...]';

export type FormatMode = 'check' | 'write';

/** `--write` keeps `--list-different` so that a write run still names the files that it changed. */
const MODE_ARGS: Record<FormatMode, string[]> = {
  check: ['--check'],
  write: ['--list-different', '--write'],
};

export interface FormatTargets {
  /** Paths relative to the working directory, as `git ls-files` emits them. */
  files: string[];
  /** Absolute paths to every `.prettierignore` governing the repository, root-most first. */
  ignorePaths: string[];
}

export type ResolveTargetsResult = { ok: true; targets: FormatTargets } | { ok: false; error: string };

/**
 * Formats or checks the files that git reports for `cwd`, and returns the exit code to report.
 *
 * Trailing arguments are git pathspecs, not Prettier flags; an unrecognized option is rejected rather
 * than passed along, since git would read it as a pathspec matching nothing and the run would report
 * success over an empty selection.
 */
export function runFmt(argv: string[], cwd: string = process.cwd()): number {
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

  const { files, ignorePaths } = resolvedTargets.targets;
  if (files.length === 0) {
    // A caller who named paths and got nothing back selected nothing, which a clean run looks exactly
    // like. Without pathspecs there is simply nothing to format, and Prettier run without file arguments
    // would read stdin and fail.
    if (parsedArgs.pathspecs.length > 0) {
      reportError(`nmr-fmt: the pathspecs did not match any formattable file: ${parsedArgs.pathspecs.join(', ')}`);
      return 1;
    }
    return 0;
  }

  const cli = resolvePrettierCli();
  if (!cli.ok) {
    reportError(`nmr-fmt: ${cli.error}`);
    return 1;
  }

  return runPrettier({ cliPath: cli.cliPath, mode: parsedArgs.mode, files, ignorePaths, cwd });
}

/**
 * Resolves what Prettier should format and which ignore files govern it, using git rather than Prettier's
 * own discovery. Prettier reads `.gitignore` and `.prettierignore` from the working directory only, so a
 * pattern in `packages/<pkg>/.gitignore` is invisible to a root-level run; git knows the whole hierarchy,
 * along with `.git/info/exclude` and `core.excludesFile`, which Prettier cannot read under any flag.
 *
 * Because file selection is anchored at `cwd` and ignore discovery at the repository root, scoping follows
 * `cwd` while the ignore rules applied to a given file are the same from every directory.
 *
 * `pathspecs` narrow the selection and are passed to git verbatim: They have git pathspec semantics rather
 * than shell glob semantics.
 */
export function resolveFormatTargets(cwd: string, pathspecs: string[] = []): ResolveTargetsResult {
  const toplevel = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (!toplevel.ok) return toplevel;

  const repositoryRoot = toplevel.stdout.trim();

  const listedFiles = runGit([...LIST_FILES_ARGS, '--', ...pathspecs], cwd);
  if (!listedFiles.ok) return listedFiles;

  const ignoreFiles = runGit([...LIST_FILES_ARGS, '--', IGNORE_FILE_PATHSPEC], repositoryRoot);
  if (!ignoreFiles.ok) return ignoreFiles;

  const discoveredIgnorePaths = splitNulSeparated(ignoreFiles.stdout)
    .filter((file) => path.basename(file) === IGNORE_FILENAME)
    .map((file) => path.resolve(repositoryRoot, file));

  return {
    ok: true,
    targets: {
      // Sort for a stable file order across runs; `--cached --others` emits untracked entries first.
      files: dedupe(splitNulSeparated(listedFiles.stdout))
        .filter((file) => isFormattableFile(cwd, file))
        .toSorted(),
      // Put the repository-root file first, whether or not it exists. Passing any explicit `--ignore-path`
      // suppresses Prettier's working-directory-relative default discovery, and that suppression makes the
      // ignore set identical from every directory. Prettier tolerates a path that is not there.
      ignorePaths: dedupe([path.join(repositoryRoot, IGNORE_FILENAME), ...discoveredIgnorePaths]),
    },
  };
}

/**
 * Reports whether Prettier can be handed a path named by git.
 *
 * git lists paths from the index, which contains paths that the filesystem does not: a file deleted but
 * not yet staged, and a broken symlink. Prettier exits 2 on a path that is not there. git also reports a
 * submodule as a single gitlink, and Prettier handed a directory recurses into it, formatting a
 * separate repository under ignore rules discovered from this one. Both are directories or absences,
 * so one is-a-file check filters out both.
 */
function isFormattableFile(cwd: string, file: string): boolean {
  return statSync(path.resolve(cwd, file), { throwIfNoEntry: false })?.isFile() === true;
}

type ParseArgsResult = { ok: true; mode: FormatMode; pathspecs: string[] } | { ok: false; error: string };

/** Reads the required mode flag and treats every remaining argument as a git pathspec. */
function parseFmtArgs(argv: string[]): ParseArgsResult {
  let mode: FormatMode | undefined;
  const pathspecs: string[] = [];

  for (const arg of argv) {
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

  return { ok: true, mode, pathspecs };
}

/**
 * Locates the Prettier CLI in the consuming repository's own installation.
 *
 * Prettier is a peer dependency rather than something that nmr bundles, because a repository's formatter
 * has to be the one that its editor and pre-commit hook also run: A copy of nmr's choosing would reformat
 * files that the editor then reformats back. Resolution goes through the module graph rather than PATH so
 * that the declared copy is the one that runs: Under pnpm's isolated layout, the `prettier` first on PATH
 * need not be the one on which the repository depends.
 *
 * The floor is a currency policy, not a capability boundary. The design requires `--ignore-path` to honour
 * every flag rather than only the last, so that a repository-root ignore file passed alongside a
 * package-level one is not silently dropped; Prettier has done that since 3.0.0. The floor is the current
 * release because every consuming repository tracks it; lowering it to 3.0.0 would not affect correctness.
 */
function resolvePrettierCli(): { ok: true; cliPath: string } | { ok: false; error: string } {
  const missingResult = {
    ok: false as const,
    error: `\`${PRETTIER_PACKAGE}\` (${PRETTIER_RANGE}) could not be resolved. Install it in this repository.`,
  };

  let manifestPath: string;
  try {
    manifestPath = createRequire(import.meta.url).resolve(`${PRETTIER_PACKAGE}/package.json`);
  } catch {
    return missingResult;
  }

  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!isObject(manifest)) return missingResult;

  // Prettier declares a lone CLI, as a bare path in 3.x and as a named map in some releases.
  const bin = isObject(manifest['bin']) ? manifest['bin'][PRETTIER_PACKAGE] : manifest['bin'];
  if (typeof bin !== 'string') return missingResult;

  return { ok: true, cliPath: path.resolve(path.dirname(manifestPath), bin) };
}

/** @internal */
export interface RunPrettierOptions {
  cliPath: string;
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
  const { cliPath, mode, files, ignorePaths, cwd, budgetBytes = ARGUMENT_BUDGET_BYTES } = options;

  const prettierArgs = [
    cliPath,
    // The file list contains types for which Prettier does not have a parser, ignore files and images among them.
    '--ignore-unknown',
    ...ignorePaths.flatMap((ignorePath) => ['--ignore-path', ignorePath]),
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

/**
 * Runs git and returns its stdout, or the reason it failed. A failure must never read as an empty file
 * list: Reporting success over a list that nothing produced is the silent-green failure that this command
 * exists to prevent.
 *
 * Invoked without a shell, because pathspecs originate in user input.
 */
function runGit(args: string[], cwd: string): { ok: true; stdout: string } | { ok: false; error: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    return { ok: false, error: stderr || `\`git ${args.join(' ')}\` failed with exit code ${result.status}.` };
  }

  return { ok: true, stdout: result.stdout };
}

/** Splits `-z` output, dropping the trailing empty element left behind by the final separator. */
function splitNulSeparated(output: string): string[] {
  return output.split('\0').filter((entry) => entry !== '');
}

/** Removes repeated entries; `--cached --others` can list the same path twice for an unmerged entry. */
function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
