import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** The ignore file Prettier reads but does not discover hierarchically. */
const IGNORE_FILENAME = '.prettierignore';

/**
 * Selects tracked files plus untracked files git does not ignore, NUL-delimited so paths containing
 * spaces or newlines survive. Untracked-but-unignored files are included so a newly created file is
 * formatted before it is ever added to the index.
 */
const LIST_FILES_ARGS = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];

/**
 * Matches `.prettierignore` at every depth in one call: git pathspec wildcards cross `/`, so this
 * finds the repository-root file and every package-level one together. It also matches names like
 * `foo.prettierignore`, which the caller filters out by basename.
 */
const IGNORE_FILE_PATHSPEC = `*${IGNORE_FILENAME}`;

export interface FormatTargets {
  /** Paths relative to the working directory, as `git ls-files` emits them. */
  files: string[];
  /** Absolute paths to every `.prettierignore` governing the repository, root-most first. */
  ignorePaths: string[];
}

export type ResolveTargetsResult = { ok: true; targets: FormatTargets } | { ok: false; error: string };

/**
 * Resolves what Prettier should format and which ignore files govern it, using git rather than Prettier's
 * own discovery. Prettier reads `.gitignore` and `.prettierignore` from the working directory only, so a
 * pattern in `packages/<pkg>/.gitignore` is invisible to a root-level run; git knows the whole hierarchy,
 * along with `.git/info/exclude` and `core.excludesFile`, which Prettier cannot read under any flag.
 *
 * File selection is anchored at `cwd` and ignore discovery at the repository root. That split is the point:
 * scoping still follows where the caller stands, while the rules applied to a given file no longer do.
 *
 * `pathspecs` narrow the selection and are passed to git verbatim, so they carry git pathspec semantics
 * rather than shell glob semantics.
 */
export function resolveFormatTargets(cwd: string, pathspecs: string[] = []): ResolveTargetsResult {
  const toplevel = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (!toplevel.ok) return toplevel;

  const repositoryRoot = toplevel.stdout.trim();

  const listed = runGit([...LIST_FILES_ARGS, '--', ...pathspecs], cwd);
  if (!listed.ok) return listed;

  const ignoreFiles = runGit([...LIST_FILES_ARGS, '--', IGNORE_FILE_PATHSPEC], repositoryRoot);
  if (!ignoreFiles.ok) return ignoreFiles;

  const discovered = splitNulSeparated(ignoreFiles.stdout)
    .filter((file) => path.basename(file) === IGNORE_FILENAME)
    .map((file) => path.resolve(repositoryRoot, file));

  return {
    ok: true,
    targets: {
      // Sorted for a stable file order across runs; `--cached --others` emits untracked entries first.
      files: dedupe(splitNulSeparated(listed.stdout)).toSorted(),
      // The repository-root file leads whether or not it exists. Passing any explicit `--ignore-path`
      // suppresses Prettier's working-directory-relative default discovery, and that suppression is what
      // makes the ignore set identical from every directory. Prettier tolerates a path that is not there.
      ignorePaths: dedupe([path.join(repositoryRoot, IGNORE_FILENAME), ...discovered]),
    },
  };
}

/**
 * Runs git and returns its stdout, or the reason it failed. A failure must never read as an empty file
 * list: reporting success over a list nothing produced is the silent-green failure this command exists
 * to prevent.
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

/** Splits `-z` output, dropping the trailing empty element the final separator leaves behind. */
function splitNulSeparated(output: string): string[] {
  return output.split('\0').filter((entry) => entry !== '');
}

/** Removes repeated entries; `--cached --others` can list the same path twice for an unmerged entry. */
function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
