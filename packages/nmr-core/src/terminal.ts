// Terminal output helpers for styled CLI messages.

import process from 'node:process';
import type { Writable } from 'node:stream';

import type { WriteResult } from './writeFileWithCheck.ts';

/**
 * Renders the canonical `Error: <message>` line (without a trailing newline) — the single
 * definition of this shape. Use it where the line is a value rather than a write target,
 * e.g. a command that returns its message for the caller to print.
 */
export function formatErrorLine(message: string): string {
  return `Error: ${message}`;
}

/** Prints an error message to stderr. */
export function printError(message: string): void {
  process.stderr.write(`  ❌ ${message}\n`);
}

/** Prints a skip/warning message to stdout. */
export function printSkip(message: string): void {
  console.info(`  ⚠️ ${message}`);
}

/** Prints a step label with a right-arrow prefix. */
export function printStep(message: string): void {
  console.info(`\n> ${message}`);
}

/** Prints a success message with a checkmark emoji prefix. */
export function printSuccess(message: string): void {
  console.info(`  ✅ ${message}`);
}

/**
 * Writes the canonical `Error: <message>` line to a stream (stderr by default) — the single
 * sanctioned door for this output shape. Pass an injected stream for in-process CLIs that
 * route output through a `Writable` rather than touching `process.stderr` directly.
 */
export function reportError(message: string, stream: Writable = process.stderr): void {
  stream.write(`${formatErrorLine(message)}\n`);
}

/** Prints a terminal message for a write result based on its outcome. */
export function reportWriteResult(result: WriteResult, dryRun: boolean): void {
  switch (result.outcome) {
    case 'created':
      if (dryRun) {
        printSuccess(`[dry-run] Would create ${result.filePath}`);
      } else {
        printSuccess(`Created ${result.filePath}`);
      }
      break;
    case 'overwritten':
      if (dryRun) {
        printSuccess(`[dry-run] Would overwrite ${result.filePath}`);
      } else {
        printSuccess(`Overwrote ${result.filePath}`);
      }
      break;
    case 'up-to-date':
      printSuccess(`${result.filePath} (up to date)`);
      break;
    case 'skipped':
      if (result.error) {
        printSkip(`${result.filePath} (could not read for comparison: ${result.error})`);
      } else {
        printSkip(`${result.filePath} (already exists)`);
      }
      break;
    case 'failed':
      if (result.error) {
        printError(`Failed to write ${result.filePath}: ${result.error}`);
      } else {
        printError(`Failed to write ${result.filePath}`);
      }
      break;
  }
}
