// Terminal reports of the outcomes that `writeFileWithCheck` and `updateManagedFile` return.

import { printError, printSkip, printSuccess, type StreamStyles } from '../terminal.ts';
import type { ManagedFileResult } from './updateManagedFile.ts';
import type { WriteResult } from './writeFileWithCheck.ts';

/**
 * Prints a status line for a managed-file result, followed by its diff indented beneath it: a failure to stderr,
 * every other outcome to stdout.
 */
export function reportTemplateUpdate(result: ManagedFileResult, isDryRun: boolean, styles?: StreamStyles): void {
  const style = styles?.stdout;
  switch (result.outcome) {
    case 'created':
      printSuccess(isDryRun ? `[dry-run] Would create ${result.filePath}` : `Created ${result.filePath}`, style);
      break;
    case 'updated':
      printSuccess(isDryRun ? `[dry-run] Would update ${result.filePath}` : `Updated ${result.filePath}`, style);
      if (result.diff !== undefined && result.diff !== '') {
        console.info(indentLines(result.diff, ' '.repeat(4)));
      }
      break;
    case 'up-to-date':
      printSuccess(`${result.filePath} (up to date)`, style);
      break;
    case 'failed': {
      const detail = result.error === undefined ? '' : `: ${result.error}`;
      printError(`Failed to update ${result.filePath}${detail}`, styles?.stderr);
      break;
    }
  }
}

/**
 * Prints a terminal message for a write result based on its outcome: a failure to stderr, every
 * other outcome to stdout. Each message takes its own stream's style from `styles`; without
 * `styles`, it takes the style detected for that stream.
 */
export function reportWriteResult(result: WriteResult, isDryRun: boolean, styles?: StreamStyles): void {
  const style = styles?.stdout;
  switch (result.outcome) {
    case 'created':
      if (isDryRun) {
        printSuccess(`[dry-run] Would create ${result.filePath}`, style);
      } else {
        printSuccess(`Created ${result.filePath}`, style);
      }
      break;
    case 'overwritten':
      if (isDryRun) {
        printSuccess(`[dry-run] Would overwrite ${result.filePath}`, style);
      } else {
        printSuccess(`Overwrote ${result.filePath}`, style);
      }
      break;
    case 'up-to-date':
      printSuccess(`${result.filePath} (up to date)`, style);
      break;
    case 'skipped':
      if (result.error) {
        printSkip(`${result.filePath} (could not read for comparison: ${result.error})`, style);
      } else {
        printSkip(`${result.filePath} (already exists)`, style);
      }
      break;
    case 'failed':
      if (result.error) {
        printError(`Failed to write ${result.filePath}: ${result.error}`, styles?.stderr);
      } else {
        printError(`Failed to write ${result.filePath}`, styles?.stderr);
      }
      break;
  }
}

// region | Helpers
/** Prefixes every line of `text` with `indent`. */
function indentLines(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}
// endregion | Helpers
