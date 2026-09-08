import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { isObject } from './type-guards.ts';

/** What a scope writes when the delegate reaches it, distinctive enough not to be read out of pnpm's own output. */
const SELECTION_MARKER = 'nmr-selected-scope';

/**
 * Asks pnpm what a `-F` pattern selects, so an invocation that would select nothing is caught before it
 * delegates.
 *
 * pnpm's own selector answers rather than a matcher of nmr's: `-F` means the whole selector language, names
 * and globs alongside `./path`, `{dir}`, `pkg...`, `!negation`, and `[since]`, and a matcher here would leave
 * every form but the simplest silently unchecked.
 *
 * Runs from the monorepo root, where the delegate runs, so a path pattern resolves against the same directory
 * in the probe as in the run it stands in for.
 *
 * The listing counts the root project wherever the filter leaves it standing, while the `exec` a delegation
 * composes runs there only where the pattern selects the root positively: `-F '!./packages/*'` lists the root
 * and executes nowhere. A listing of the root alone is therefore the one reading the listing cannot settle,
 * and it is put to `exec` itself. Every other listing settles on its own, a selection of two or more running
 * in at least one scope whether or not the root is among them.
 */
export function readFilterSelection(pattern: string, monorepoRoot: string): FilterSelection {
  const listing = spawnSync('pnpm', ['ls', '--filter', pattern, '--depth', '-1', '--json'], {
    cwd: monorepoRoot,
    encoding: 'utf8',
  });

  const reading = interpretSelectionProbe(
    { error: listing.error, status: listing.status, stdout: listing.stdout },
    monorepoRoot,
  );

  return reading === 'root-only' ? readDelegateSelection(pattern, monorepoRoot) : reading;
}

/**
 * Reduces a listing to what it proves about the selection.
 *
 * Only `empty` is a positive claim, so every outcome the probe cannot read resolves to `unresolved` and the
 * invocation delegates as it would have. A pattern pnpm rejects rather than resolves, such as a bad git ref in
 * a changed-since selector, is pnpm's to report, and reporting it here as a match failure would name a
 * different fault than the one the user has.
 */
export function interpretSelectionProbe(probe: SelectionProbe, monorepoRoot: string): ProbeReading {
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

  if (parsed.length === 0) {
    return 'empty';
  }

  return parsed.every((entry: unknown) => isRootEntry(entry, monorepoRoot)) ? 'root-only' : 'selected';
}

/** Reduces a marked delegate run to what it proves: a scope that wrote the marker is a scope the run reached. */
export function interpretDelegateProbe(probe: SelectionProbe): FilterSelection {
  if (probe.error !== undefined || probe.status !== 0) {
    return 'unresolved';
  }

  return probe.stdout.includes(SELECTION_MARKER) ? 'selected' : 'empty';
}

/** What a `-F` pattern selected, as far as pnpm could be asked. */
export type FilterSelection = 'empty' | 'selected' | 'unresolved';

/** What a listing proves, `root-only` being the reading that only the delegate can settle. */
export type ProbeReading = FilterSelection | 'root-only';

/** The part of a probe's completion a selection is read from. */
export interface SelectionProbe {
  error: Error | undefined;
  status: number | null;
  stdout: string;
}

// region | Helpers

/** Reports whether a listing entry is the monorepo root, whose path pnpm reports with symbolic links resolved. */
function isRootEntry(entry: unknown, monorepoRoot: string): boolean {
  if (!isObject(entry) || typeof entry['path'] !== 'string') {
    return false;
  }

  return readRealPath(entry['path']) === readRealPath(monorepoRoot);
}

/** Resolves symbolic links out of a path, falling back to the resolved path where the target cannot be read. */
function readRealPath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Puts the pattern to the delegate's own selection, running a marker in each scope it reaches.
 *
 * The marker is what tells an empty selection from a scope that printed nothing, which is the signal `exec`
 * itself withholds: its exit code is 0 either way.
 */
function readDelegateSelection(pattern: string, monorepoRoot: string): FilterSelection {
  const probe = spawnSync(
    'pnpm',
    ['--filter', pattern, 'exec', process.execPath, '--eval', `process.stdout.write('${SELECTION_MARKER}')`],
    { cwd: monorepoRoot, encoding: 'utf8' },
  );

  return interpretDelegateProbe({ error: probe.error, status: probe.status, stdout: probe.stdout });
}

// endregion | Helpers
