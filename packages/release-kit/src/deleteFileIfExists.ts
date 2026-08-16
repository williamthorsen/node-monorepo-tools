import { unlinkSync } from 'node:fs';

import { hasErrnoCode } from '@williamthorsen/nmr-core';

/** Delete a file, silently ignoring the case where it does not exist. */
export function deleteFileIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error: unknown) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
}
