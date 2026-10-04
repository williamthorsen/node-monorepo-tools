import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { hasErrnoCode, reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

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

/** Stat failures that deny this process access to a path, which Prettier could not read either. */
const UNREADABLE_CODES = ['EACCES', 'EPERM'];

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
  /** Listed paths that this process is denied access to, each with the errno code that its stat raised. */
  unreadableFiles: UnreadableFile[];
}

export interface UnreadableFile {
  file: string;
  code: string;
}

export type ResolveTargetsResult = { ok: true; targets: FormatTargets } | { ok: false; error: string };

/**
 * Formats or checks the files that git reports for `cwd`, and returns the exit code to report. A repository
 * without a Prettier config of its own is formatted with the house config.
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

  const { files, ignorePaths, unreadableFiles } = resolvedTargets.targets;
  // Name each skipped path, so that a passing check does not hide the files that it never read.
  for (const { file, code } of unreadableFiles) {
    process.stderr.write(`nmr-fmt: skipped ${file}, which cannot be read (${code})\n`);
  }

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

  return runPrettier({
    cliPath: cli.cliPath,
    configPath: repositoryConfig.found ? undefined : DEFAULT_CONFIG_PATH,
    mode: parsedArgs.mode,
    files,
    ignorePaths,
    cwd,
  });
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
 *
 * A listed path that this process is denied access to is set aside in `unreadableFiles`; any other stat failure
 * fails the resolution.
 */
export function resolveFormatTargets(cwd: string, pathspecs: string[] = []): ResolveTargetsResult {
  const toplevel = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (!toplevel.ok) return toplevel;

  const repositoryRoot = toplevel.stdout.trim();

  const listedFiles = runGit([...LIST_FILES_ARGS, '--', ...pathspecs], cwd);
  if (!listedFiles.ok) return listedFiles;

  const ignoreFiles = runGit([...LIST_FILES_ARGS, '--', IGNORE_FILE_PATHSPEC], repositoryRoot);
  if (!ignoreFiles.ok) return ignoreFiles;

  const files: string[] = [];
  const unreadableFiles: UnreadableFile[] = [];
  const listedPaths = dedupe(splitNulSeparated(listedFiles.stdout));
  for (const file of listedPaths) {
    const status = classifyListedFile(cwd, file);
    switch (status.kind) {
      case 'excluded':
        break;
      case 'failed':
        return { ok: false, error: status.error };
      case 'formattable':
        files.push(file);
        break;
      case 'unreadable':
        unreadableFiles.push({ file, code: status.code });
        break;
    }
  }

  const discoveredIgnorePaths = splitNulSeparated(ignoreFiles.stdout)
    .filter((file) => path.basename(file) === IGNORE_FILENAME)
    .map((file) => path.resolve(repositoryRoot, file));

  return {
    ok: true,
    targets: {
      // Sort for a stable file order across runs; `--cached --others` emits untracked entries first.
      files: files.toSorted(),
      // Put the repository-root file first, whether or not it exists. Passing any explicit `--ignore-path`
      // suppresses Prettier's working-directory-relative default discovery, and that suppression makes the
      // ignore set identical from every directory. Prettier tolerates a path that is not there.
      ignorePaths: dedupe([path.join(repositoryRoot, IGNORE_FILENAME), ...discoveredIgnorePaths]),
      unreadableFiles,
    },
  };
}

type ListedFileStatus =
  | { kind: 'formattable' }
  | { kind: 'excluded' }
  | { kind: 'unreadable'; code: string }
  | { kind: 'failed'; error: string };

/**
 * Classifies a path named by git by whether Prettier can be handed it.
 *
 * Only a regular file qualifies. git lists paths from the index, which contains paths that the filesystem
 * does not, such as a file deleted but not yet staged, and Prettier exits 2 on a path that is not there.
 * git reports a submodule as a single gitlink, and Prettier handed a directory recurses into it,
 * formatting a separate repository under ignore rules discovered from this one. git also records a
 * symlink as a path of its own, and Prettier rejects a symlink named explicitly whatever its target, so
 * the link itself is tested rather than what it points at. A path that this process is denied access to,
 * such as a dotfile that a sandbox shields, is unreadable to Prettier as well.
 */
function classifyListedFile(cwd: string, file: string): ListedFileStatus {
  try {
    const stats = lstatSync(path.resolve(cwd, file), { throwIfNoEntry: false });
    return stats?.isFile() === true ? { kind: 'formattable' } : { kind: 'excluded' };
  } catch (error) {
    const code = UNREADABLE_CODES.find((candidate) => hasErrnoCode(error, candidate));
    if (code !== undefined) return { kind: 'unreadable', code };
    return { kind: 'failed', error: `could not stat ${file}: ${describeError(error)}` };
  }
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
  const { cliPath, configPath, mode, files, ignorePaths, cwd, budgetBytes = ARGUMENT_BUDGET_BYTES } = options;

  const prettierArgs = [
    cliPath,
    ...(configPath === undefined ? [] : ['--config', configPath]),
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

/** Resolves `specifier` as a module importing from `parent` would, or returns `undefined` when it cannot. */
function resolveFrom(parent: string, specifier: string): string | undefined {
  try {
    return createRequire(parent).resolve(specifier);
  } catch {
    return undefined;
  }
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
