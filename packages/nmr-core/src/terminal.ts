// Terminal output helpers for styled CLI messages, and the repo's single seam over `@williamthorsen/toolbelt.terminal`.

import process from 'node:process';
import type { Writable } from 'node:stream';

import {
  detectOutputStyle,
  type InvalidOutputStyle,
  measureGlyphColumn,
  type OutputStyle,
  resolveOutputStyle,
  STATUS_GLYPHS,
  type StatusGlyphName,
} from '@williamthorsen/toolbelt.terminal/candidate';

import type { WriteResult } from './writeFileWithCheck.ts';

export type {
  GlyphSet,
  InvalidOutputStyle,
  OutputStyle,
  StatusGlyphName,
} from '@williamthorsen/toolbelt.terminal/candidate';
export {
  defineGlyphSet,
  describeInvalidOutputStyle,
  measureGlyphColumn,
  STATUS_GLYPHS,
  wrapToWidth,
} from '@williamthorsen/toolbelt.terminal/candidate';

export interface ResolveStreamStylesOptions {
  /** Raw arguments in which to find `flag`; read only when `flag` is given. */
  readonly argv?: readonly string[] | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The environment variable holding the caller's standing preference: `auto`, `plain`, or `rich`. */
  readonly envVar: string;
  /** The flag naming a style for one invocation, leading dashes included; it outranks `envVar`. */
  readonly flag?: string | undefined;
  readonly stderrIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

export interface StreamStyleResolution {
  /** The first value of `flag` or `envVar` that names no setting; resolution continues with the next source. */
  readonly invalid?: InvalidOutputStyle | undefined;
  readonly styles: StreamStyles;
}

export interface StreamStyles {
  readonly stderr: OutputStyle;
  readonly stdout: OutputStyle;
}

/**
 * Renders the canonical `Error: <message>` line (without a trailing newline) — the single
 * definition of this shape. Use it where the line is a value rather than a write target,
 * e.g. a command that returns its message for the caller to print.
 */
export function formatErrorLine(message: string): string {
  return `Error: ${message}`;
}

/** Renders a status marker and a message, padding the marker so that messages align across statuses. */
export function formatStatusLine(style: OutputStyle, status: StatusGlyphName, message: string): string {
  const glyphs = STATUS_GLYPHS[style];
  const glyph = glyphs[status];
  const padding = ' '.repeat(measureGlyphColumn(glyphs) - glyph.width);
  return `${glyph.text}${padding} ${message}`;
}

/** Prints an error message to stderr, in the style detected for stderr unless one is given. */
export function printError(message: string, style: OutputStyle = detectStreamStyle(process.stderr)): void {
  process.stderr.write(`  ${formatStatusLine(style, 'failed', message)}\n`);
}

/** Prints a skip/warning message to stdout, in the style detected for stdout unless one is given. */
export function printSkip(message: string, style: OutputStyle = detectStreamStyle(process.stdout)): void {
  console.info(`  ${formatStatusLine(style, 'warning', message)}`);
}

/** Prints a step label with a right-arrow prefix. */
export function printStep(message: string): void {
  console.info(`\n> ${message}`);
}

/** Prints a success message to stdout, in the style detected for stdout unless one is given. */
export function printSuccess(message: string, style: OutputStyle = detectStreamStyle(process.stdout)): void {
  console.info(`  ${formatStatusLine(style, 'passed', message)}`);
}

/**
 * Writes the canonical `Error: <message>` line to a stream (stderr by default) — the single
 * sanctioned door for this output shape. Pass an injected stream for in-process CLIs that
 * route output through a `Writable` rather than touching `process.stderr` directly.
 */
export function reportError(message: string, stream: Writable = process.stderr): void {
  stream.write(`${formatErrorLine(message)}\n`);
}

/**
 * Prints a terminal message for a write result based on its outcome. A given style applies to
 * every outcome; without one, each message takes the style detected for its own stream.
 */
export function reportWriteResult(result: WriteResult, dryRun: boolean, style?: OutputStyle): void {
  switch (result.outcome) {
    case 'created':
      if (dryRun) {
        printSuccess(`[dry-run] Would create ${result.filePath}`, style);
      } else {
        printSuccess(`Created ${result.filePath}`, style);
      }
      break;
    case 'overwritten':
      if (dryRun) {
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
        printError(`Failed to write ${result.filePath}: ${result.error}`, style);
      } else {
        printError(`Failed to write ${result.filePath}`, style);
      }
      break;
  }
}

/**
 * Resolves the style of each output stream: the flag when one is named, else the named environment
 * variable, else detection from `CI`, the stream's terminal state, and `TERM`. Never throws; a value
 * that names no setting is returned in `invalid`, for the caller to report with
 * `describeInvalidOutputStyle`.
 */
export function resolveStreamStyles(options: ResolveStreamStylesOptions): StreamStyleResolution {
  const { argv = [], env, envVar, flag, stderrIsTty, stdoutIsTty } = options;
  const stderr = resolveOutputStyle({ argv, env, envVar, flag, isTty: stderrIsTty });
  const stdout = resolveOutputStyle({ argv, env, envVar, flag, isTty: stdoutIsTty });
  const styles = { stderr: stderr.style, stdout: stdout.style };
  // Both resolutions read the same flag and variable, so either one reports an invalid value.
  return stdout.invalid === undefined ? { styles } : { invalid: stdout.invalid, styles };
}

// region | Helpers
/** Detects the style that the process environment calls for on one of its output streams. */
function detectStreamStyle(stream: { readonly isTTY?: boolean | undefined }): OutputStyle {
  return detectOutputStyle({ env: process.env, isTty: stream.isTTY === true });
}
// endregion | Helpers
