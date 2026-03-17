import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Print result: created, skipped, dry-run, or failed. */
interface WriteResult {
  action: 'created' | 'skipped' | 'dry-run' | 'failed';
  filePath: string;
}

/**
 * Write a file if it does not already exist (or if `overwrite` is true).
 *
 * Creates parent directories as needed. In dry-run mode, reports what would happen without writing.
 * Returns a result indicating what happened; filesystem errors are caught and reported as `'failed'`.
 */
export function writeIfAbsent(filePath: string, content: string, dryRun: boolean, overwrite: boolean): WriteResult {
  if (existsSync(filePath) && !overwrite) {
    console.info(`  Skipped ${filePath} (already exists)`);
    return { action: 'skipped', filePath };
  }

  if (dryRun) {
    console.info(`  [dry-run] Would create ${filePath}`);
    return { action: 'dry-run', filePath };
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  Failed to write ${filePath}: ${message}`);
    return { action: 'failed', filePath };
  }

  console.info(`  Created ${filePath}`);
  return { action: 'created', filePath };
}
