import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';

/** Outcome of a `writeFileWithCheck` call. */
export type WriteOutcome = 'created' | 'overwritten' | 'up-to-date' | 'skipped' | 'failed';

/** Result returned by `writeFileWithCheck`. */
export interface WriteResult {
  filePath: string;
  outcome: WriteOutcome;
  error?: string;
}

/** Strips trailing whitespace from each line and from EOF. */
function normalizeTrailingWhitespace(content: string): string {
  return content
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

/**
 * Writes a file with existence and content checks, creating parent directories as needed.
 *
 * Without `shouldOverwrite`, leaves an existing file alone and reports it `up-to-date` when its content matches up to
 * trailing whitespace. With `isDryRun`, returns the outcome without writing. Returns a filesystem error in the
 * result rather than throwing it: `skipped` when the existing file cannot be read, `failed` when the write fails.
 */
export function writeFileWithCheck(
  filePath: string,
  content: string,
  options: { isDryRun: boolean; shouldOverwrite: boolean },
): WriteResult {
  const { isDryRun, shouldOverwrite } = options;
  const fileExists = existsSync(filePath);

  if (fileExists && !shouldOverwrite) {
    try {
      const existing = readFileSync(filePath, 'utf8');
      if (normalizeTrailingWhitespace(existing) === normalizeTrailingWhitespace(content)) {
        return { filePath, outcome: 'up-to-date' };
      }
    } catch (error: unknown) {
      const message = describeError(error);
      return { filePath, outcome: 'skipped', error: message };
    }
    return { filePath, outcome: 'skipped' };
  }

  const outcome: WriteOutcome = fileExists ? 'overwritten' : 'created';

  if (isDryRun) {
    return { filePath, outcome };
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch (error: unknown) {
    const message = describeError(error);
    return { filePath, outcome: 'failed', error: message };
  }

  try {
    writeFileSync(filePath, content, 'utf8');
  } catch (error: unknown) {
    const message = describeError(error);
    return { filePath, outcome: 'failed', error: message };
  }

  return { filePath, outcome };
}
