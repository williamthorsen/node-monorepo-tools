import { unlinkSync } from 'node:fs';

import { hasErrnoCode } from '@williamthorsen/nmr-core';

import { asUserError } from './user-error-chaining.ts';

/** Deletes a file, ignoring one that does not exist. */
export function deleteFileIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error: unknown) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return;
    }
    throw asUserError(error);
  }
}
