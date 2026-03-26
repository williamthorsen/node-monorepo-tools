import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { printError, printSkip, printSuccess } from '../lib/terminal.ts';
import { preflightConfigTemplate } from './templates.ts';

const CONFIG_PATH = '.config/preflight.config.ts';

/** Strip trailing whitespace from each line and from EOF. */
function normalizeTrailingWhitespace(content: string): string {
  return content
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

/** Attempt to write a file, printing a user-friendly error on failure. Returns true on success. */
function tryWriteFile(filePath: string, content: string): boolean {
  try {
    writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to write ${filePath}: ${message}`);
    return false;
  }
}

/** Write a file, creating parent directories as needed. Skip if the file already exists and overwrite is false. */
function writeIfAbsent(filePath: string, content: string, dryRun: boolean, overwrite: boolean): void {
  if (existsSync(filePath) && !overwrite) {
    try {
      const existing = readFileSync(filePath, 'utf8');
      if (normalizeTrailingWhitespace(existing) === normalizeTrailingWhitespace(content)) {
        printSuccess(`${filePath} (up to date)`);
        return;
      }
    } catch {
      // Fall through to skip message if reading fails.
    }
    printSkip(`${filePath} (already exists)`);
    return;
  }

  if (dryRun) {
    printSuccess(`[dry-run] Would create ${filePath}`);
    return;
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to create directory for ${filePath}: ${message}`);
    return;
  }

  if (tryWriteFile(filePath, content)) {
    printSuccess(`Created ${filePath}`);
  }
}

interface ScaffoldOptions {
  dryRun: boolean;
  force: boolean;
}

/** Scaffold the preflight config file. */
export function scaffoldConfig({ dryRun, force }: ScaffoldOptions): void {
  writeIfAbsent(CONFIG_PATH, preflightConfigTemplate(), dryRun, force);
}
