import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Print result: created, skipped, or dry-run. */
interface WriteResult {
  action: 'created' | 'skipped' | 'dry-run';
  filePath: string;
}

/**
 * Write a file if it does not already exist (or if `overwrite` is true).
 *
 * Creates parent directories as needed. In dry-run mode, reports what would happen without writing.
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

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  console.info(`  Created ${filePath}`);
  return { action: 'created', filePath };
}
