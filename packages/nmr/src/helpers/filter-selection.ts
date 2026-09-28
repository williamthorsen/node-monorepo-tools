import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { isObject } from './type-guards.ts';

/** What a scope writes when the delegate runs in it, distinctive enough not to be mistaken for pnpm's own output. */
const SELECTION_MARKER = 'nmr-selected-scope';

/**
 * Asks pnpm what a `-F` pattern selects, so that an invocation that would select nothing is caught before it
 * delegates, and one selecting several packages is distinguished from one selecting a single package.
 *
 * pnpm answers because `-F` accepts pnpm's whole selector language: names and globs alongside `./path`, `{dir}`,
 * `pkg...`, `!negation`, and `[since]`.
 *
 * Runs from the monorepo root, where the delegate runs, so that a path pattern resolves against the same
 * directory in the probe as in the run that it stands in for.
 *
 * The listing counts the root project wherever the filter does not exclude it, while the `exec` that a
 * delegation composes runs there only when the pattern selects the root positively: `-F '!./packages/*'` lists
 * the root and executes nowhere. A listing of the root alone is therefore the one reading that the listing
 * cannot settle, and that reading is checked against `exec` itself. Every other listing settles on its own, and
 * counts the packages beside the root: two of them run in two scopes, while one beside the root may run in that
 * package alone.
 */
export function readFilterSelection(pattern: string, monorepoRoot: string): FilterSelection {
  const listingRun = spawnSync('pnpm', ['ls', '--filter', pattern, '--depth', '-1', '--json'], {
    cwd: monorepoRoot,
    encoding: 'utf8',
  });

  const probeReading = interpretSelectionProbe(
    { error: listingRun.error, status: listingRun.status, stdout: listingRun.stdout },
    monorepoRoot,
  );

  return probeReading === 'root-only' ? readDelegateSelection(pattern, monorepoRoot) : probeReading;
}

/**
 * Reduces a listing to what it proves about the selection.
 *
 * Every outcome that the probe cannot read resolves to `unresolved`, which claims nothing about the selection,
 * and the invocation delegates as it would have. A pattern that pnpm rejects rather than resolves, such as a bad
 * git ref in a changed-since selector, is pnpm's to report, and reporting it here as a match failure would name a
 * different fault than the one that the user has.
 */
export function interpretSelectionProbe(probe: SelectionProbe, monorepoRoot: string): ProbeReading {
  if (probe.error !== undefined || probe.status !== 0) {
    return 'unresolved';
  }

  let parsedListing: unknown;
  try {
    parsedListing = JSON.parse(probe.stdout);
  } catch {
    return 'unresolved';
  }

  if (!Array.isArray(parsedListing)) {
    return 'unresolved';
  }

  if (parsedListing.length === 0) {
    return 'empty';
  }

  const packageCount = parsedListing.filter((entry: unknown) => !isRootEntry(entry, monorepoRoot)).length;
  if (packageCount === 0) {
    return 'root-only';
  }

  return packageCount === 1 ? 'single' : 'multiple';
}

/**
 * Reduces a marked delegate run to what it proves: a scope that wrote the marker is a scope that the run
 * reached. Because the run is made only for a listing of the root alone, that scope is the only one.
 */
export function interpretDelegateProbe(probe: SelectionProbe): FilterSelection {
  if (probe.error !== undefined || probe.status !== 0) {
    return 'unresolved';
  }

  return probe.stdout.includes(SELECTION_MARKER) ? 'single' : 'empty';
}

/** What a `-F` pattern selected, as far as pnpm could be asked. `multiple` is two or more packages beside the root. */
export type FilterSelection = 'empty' | 'multiple' | 'single' | 'unresolved';

/** What a listing proves, `root-only` being the reading that only the delegate can settle. */
export type ProbeReading = FilterSelection | 'root-only';

/** The part of a probe's completion from which a selection is read. */
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

  return resolveRealPath(entry['path']) === resolveRealPath(monorepoRoot);
}

/** Resolves symbolic links out of a path, falling back to the resolved path when the target cannot be read. */
function resolveRealPath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Tests the pattern against the delegate's own selection, running a marker in each scope that it reaches.
 *
 * The marker distinguishes an empty selection from a scope that printed nothing, a distinction that `exec`
 * itself does not report: its exit code is 0 either way.
 */
function readDelegateSelection(pattern: string, monorepoRoot: string): FilterSelection {
  const probeRun = spawnSync(
    'pnpm',
    ['--filter', pattern, 'exec', process.execPath, '--eval', `process.stdout.write('${SELECTION_MARKER}')`],
    { cwd: monorepoRoot, encoding: 'utf8' },
  );

  return interpretDelegateProbe({ error: probeRun.error, status: probeRun.status, stdout: probeRun.stdout });
}

// endregion | Helpers
