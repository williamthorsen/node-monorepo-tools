import { readFile, writeFile } from 'node:fs/promises';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { isObject } from './helpers/type-guards.ts';

/**
 * Names the file in which an nmr bin states its own outcome to the nmr process that runs it. nmr sets it for each
 * opaque step and removes it from every other process that it starts.
 */
export const OUTCOME_FILE_ENV_VAR = 'NMR_OUTCOME_FILE';

/**
 * An outcome that a bin states about its own run, which a passing verdict reports in its detail slot.
 *
 * `build-unchanged` is a build-cache hit. Its `savedMs` is the emit time recorded for the current inputs, whatever
 * its size, and is absent when none was recorded; whether a saving is worth naming belongs to rendering.
 */
export interface StatedOutcome {
  kind: 'build-unchanged';
  savedMs?: number;
}

/**
 * Reads the outcome that a step stated in `filePath`, or `undefined` when it stated none. A record that cannot be
 * read as a stated outcome is reported to `onRejection` and treated as none, so that a bin from another nmr version
 * cannot break the verdict.
 */
export async function readStatedOutcome(
  filePath: string,
  onRejection: (reason: string) => void,
): Promise<StatedOutcome | undefined> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    onRejection(`could not read ${filePath}: ${describeError(error)}`);
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    onRejection(`${filePath} does not contain JSON`);
    return undefined;
  }

  if (!isStatedOutcome(value)) {
    onRejection(`${filePath} does not contain a stated outcome that this nmr knows`);
    return undefined;
  }

  return value.savedMs === undefined ? { kind: value.kind } : { kind: value.kind, savedMs: value.savedMs };
}

/**
 * Writes the outcome into the file that `NMR_OUTCOME_FILE` names, and does nothing when it is unset. The statement is
 * advisory: A write that fails leaves the verdict reading as it would without one.
 */
export async function writeStatedOutcome(env: NodeJS.ProcessEnv, outcome: StatedOutcome): Promise<void> {
  const filePath = env[OUTCOME_FILE_ENV_VAR];
  if (filePath === undefined || filePath === '') {
    return;
  }

  try {
    await writeFile(filePath, JSON.stringify(outcome));
  } catch {
    // Losing the statement drops only the detail that the verdict would have reported.
  }
}

// region | Helpers

/** Reports whether an error is the one that reading a file that does not exist throws. */
function isMissingFileError(error: unknown): boolean {
  return isObject(error) && error['code'] === 'ENOENT';
}

/** Narrows a parsed record to a stated outcome of a kind that this nmr renders. */
function isStatedOutcome(value: unknown): value is StatedOutcome {
  if (!isObject(value) || value['kind'] !== 'build-unchanged') {
    return false;
  }

  const savedMs = value['savedMs'];
  return savedMs === undefined || (typeof savedMs === 'number' && Number.isFinite(savedMs) && savedMs >= 0);
}

// endregion | Helpers
