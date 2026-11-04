import type { Writable } from 'node:stream';

import { reportCrash, reportError } from '@williamthorsen/nmr-core';

import { UserError } from './UserError.ts';

/**
 * Writes a failure to the CLI's error stream: as its message alone when the user's own declaration caused it,
 * and as an internal error with its stack otherwise.
 *
 * A stack records where nmr noticed a problem, which says nothing about the file that a user has to edit; for
 * nmr's own fault it is where a report has to start.
 */
export function reportCliFailure(error: unknown, stderr: Writable): void {
  if (error instanceof UserError) {
    reportError(error.message, stderr);
    return;
  }

  reportCrash('nmr', error, stderr);
}
