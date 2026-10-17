import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';

import { hasErrnoCode } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

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

export interface FormatTargets {
  /** Listed paths that Prettier cannot be handed, such as symlinks and submodule gitlinks. */
  excludedFiles: string[];
  /** Paths relative to the working directory, as `git ls-files` emits them. */
  files: string[];
  /** Absolute paths to every `.prettierignore` governing the repository, root-most first. */
  ignorePaths: string[];
  /** The repository's top-level directory, as git reports it. */
  repositoryRoot: string;
  /** Listed paths that this process is denied access to, each with the errno code that its stat raised. */
  unreadableFiles: UnreadableFile[];
}

export interface UnreadableFile {
  file: string;
  code: string;
}

export type ResolveTargetsResult = { ok: true; targets: FormatTargets } | { ok: false; error: string };

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
 * A listed path that Prettier cannot be handed is set aside in `excludedFiles`, and one that this process is denied
 * access to in `unreadableFiles`; any other stat failure fails the resolution.
 */
export function resolveFormatTargets(cwd: string, pathspecs: string[] = []): ResolveTargetsResult {
  const toplevel = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (!toplevel.ok) return toplevel;

  const repositoryRoot = toplevel.stdout.trim();

  const listedFiles = runGit([...LIST_FILES_ARGS, '--', ...pathspecs], cwd);
  if (!listedFiles.ok) return listedFiles;

  const ignoreFiles = runGit([...LIST_FILES_ARGS, '--', IGNORE_FILE_PATHSPEC], repositoryRoot);
  if (!ignoreFiles.ok) return ignoreFiles;

  const excludedFiles: string[] = [];
  const files: string[] = [];
  const unreadableFiles: UnreadableFile[] = [];
  const listedPaths = dedupe(splitNulSeparated(listedFiles.stdout));
  for (const file of listedPaths) {
    const status = classifyListedFile(cwd, file);
    switch (status.kind) {
      case 'excluded':
        excludedFiles.push(file);
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
      excludedFiles: excludedFiles.toSorted(),
      // Sort for a stable file order across runs; `--cached --others` emits untracked entries first.
      files: files.toSorted(),
      // Put the repository-root file first, whether or not it exists. Passing any explicit `--ignore-path`
      // suppresses Prettier's working-directory-relative default discovery, and that suppression makes the
      // ignore set identical from every directory. Prettier tolerates a path that is not there.
      ignorePaths: dedupe([path.join(repositoryRoot, IGNORE_FILENAME), ...discoveredIgnorePaths]),
      repositoryRoot,
      unreadableFiles,
    },
  };
}

// region | Helpers

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
    return { kind: stats?.isFile() === true ? 'formattable' : 'excluded' };
  } catch (error) {
    const code = UNREADABLE_CODES.find((candidate) => hasErrnoCode(error, candidate));
    if (code !== undefined) return { kind: 'unreadable', code };
    return { kind: 'failed', error: `could not stat ${file}: ${describeError(error)}` };
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

// endregion | Helpers
