import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';
import { structuredPatch } from 'diff';

/** Outcome of an `updateManagedFile` call. */
export type ManagedFileOutcome = 'created' | 'updated' | 'up-to-date' | 'failed';

/** Result returned by `updateManagedFile`. */
export interface ManagedFileResult {
  filePath: string;
  outcome: ManagedFileOutcome;
  /** Hunks of a unified diff from the existing file to the rendered content; present only for `updated`. */
  diff?: string;
  error?: string;
}

/**
 * Writes `content` to a file that a package renders from a template, when the file is missing or its bytes differ.
 *
 * With `dryRun`, returns the outcome and diff without writing. Returns a filesystem error in the result rather than
 * throwing it.
 */
export function updateManagedFile(filePath: string, content: string, options: { dryRun: boolean }): ManagedFileResult {
  let existing: string | undefined;
  if (existsSync(filePath)) {
    try {
      existing = readFileSync(filePath, 'utf8');
    } catch (error: unknown) {
      return { filePath, outcome: 'failed', error: describeError(error) };
    }
    if (existing === content) {
      return { filePath, outcome: 'up-to-date' };
    }
  }

  const result: ManagedFileResult =
    existing === undefined
      ? { filePath, outcome: 'created' }
      : { filePath, outcome: 'updated', diff: formatHunks(existing, content) };

  if (options.dryRun) {
    return result;
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  } catch (error: unknown) {
    return { filePath, outcome: 'failed', error: describeError(error) };
  }

  return result;
}

// region | Helpers
/** Renders the hunks of a unified diff, without file headers or end-of-file newline markers. */
function formatHunks(before: string, after: string): string {
  const { hunks } = structuredPatch('', '', before, after, undefined, undefined, { context: 3 });
  return hunks
    .flatMap((hunk) => [
      `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`,
      ...hunk.lines.filter((line) => !line.startsWith('\\')),
    ])
    .join('\n');
}
// endregion | Helpers
