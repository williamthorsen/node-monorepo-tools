import { updateManagedFile } from '@williamthorsen/nmr-core';
import type { CheckOutcome } from 'readyup';

/** Checks whether a file's content equals the rendered template, naming the differing hunks on a mismatch. */
export function fileMatchesTemplate(filePath: string, expected: string): CheckOutcome {
  const result = updateManagedFile(filePath, expected, { isDryRun: true });
  switch (result.outcome) {
    case 'up-to-date':
      return { ok: true };
    case 'updated':
      return { ok: false, detail: `${filePath} differs from the template:\n${result.diff ?? ''}` };
    case 'created':
      return { ok: false, detail: `${filePath} is missing` };
    case 'failed':
      return { ok: false, detail: `${filePath} could not be read: ${result.error ?? 'unknown error'}` };
  }
}
