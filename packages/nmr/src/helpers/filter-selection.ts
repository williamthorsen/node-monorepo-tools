import { spawnSync } from 'node:child_process';

/**
 * Asks pnpm what a `-F` pattern selects, so an invocation that would select nothing is caught before it
 * delegates.
 *
 * pnpm's own selector answers rather than a matcher of nmr's: `-F` means the whole selector language, names
 * and globs alongside `./path`, `pkg...`, `!negation`, and `[since]`, and a matcher here would leave every
 * form but the simplest silently unchecked.
 *
 * Runs from the monorepo root, where the delegate runs, so a path pattern resolves against the same directory
 * in the probe as in the run it stands in for.
 */
export function readFilterSelection(pattern: string, monorepoRoot: string): FilterSelection {
  const result = spawnSync('pnpm', ['ls', '--filter', pattern, '--depth', '-1', '--json'], {
    cwd: monorepoRoot,
    encoding: 'utf8',
  });

  return interpretSelectionProbe({ error: result.error, status: result.status, stdout: result.stdout });
}

/**
 * Reduces a probe's outcome to what it proves about the selection.
 *
 * Only `empty` is a positive claim, so every outcome the probe cannot read resolves to `unresolved` and the
 * invocation delegates as it would have. A pattern pnpm rejects rather than resolves, such as a bad git ref in
 * a changed-since selector, is pnpm's to report, and reporting it here as a match failure would name a
 * different fault than the one the user has.
 */
export function interpretSelectionProbe(probe: SelectionProbe): FilterSelection {
  if (probe.error !== undefined || probe.status !== 0) {
    return 'unresolved';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(probe.stdout);
  } catch {
    return 'unresolved';
  }

  if (!Array.isArray(parsed)) {
    return 'unresolved';
  }

  return parsed.length === 0 ? 'empty' : 'selected';
}

/** What a `-F` pattern selected, as far as pnpm could be asked. */
export type FilterSelection = 'empty' | 'selected' | 'unresolved';

/** The part of a probe's completion the selection is read from. */
export interface SelectionProbe {
  error: Error | undefined;
  status: number | null;
  stdout: string;
}
