import type { Writable } from 'node:stream';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors/candidate';

import { UserError } from './UserError.ts';

/**
 * Writes a failure to the CLI's error stream: as its message alone when the user's own declaration caused it,
 * and with its stack otherwise.
 *
 * A stack records where nmr noticed a problem, which says nothing about the file a user has to edit; for nmr's
 * own fault it is where a report has to start. `describeError` covers an `Error` carrying no stack and a thrown
 * non-`Error` alike.
 */
export function reportCliFailure(error: unknown, stderr: Writable): void {
  if (error instanceof UserError) {
    reportError(error.message, stderr);
    return;
  }

  const detail = error instanceof Error && error.stack !== undefined ? error.stack : describeError(error);
  stderr.write(`${detail}\n`);
}
