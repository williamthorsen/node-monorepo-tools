import { unlinkSync } from 'node:fs';

/** Delete a file, silently ignoring the case where it does not exist. */
export function deleteFileIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}
