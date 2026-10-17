import type { Writable } from 'node:stream';

import { describeInvalidOutputStyle, type OutputStyle, type StreamStyles } from '@williamthorsen/nmr-core';

import { isHookName } from './helpers/hook-name.ts';
import { resolveOutputStyles } from './output-style.ts';
import { readReportFormatEnv, type ReportFormat } from './report-format.ts';
import {
  type CommandVerbosity,
  readVerbosityEnv,
  resolveVerbosity,
  type ResolveVerbosityOptions,
} from './verbosity.ts';
import { type Verdict, writeVerdict } from './verdict.ts';

/**
 * Reads everything that decides how a run presents itself: the two inherited variables, and the style that each
 * output stream resolves to. Reports the first value that cannot be read.
 *
 * The style is resolved here rather than beside its use, so that a value that does not name a style is rejected
 * at the same point as an unreadable variable, which is ahead of `--version` and of the config load.
 */
export function readPresentation(options: {
  env: NodeJS.ProcessEnv;
  flagValue: string | undefined;
  stderrIsTty: boolean;
  stdoutIsTty: boolean;
}): PresentationRead {
  const { env } = options;

  const verbosity = readVerbosityEnv(env);
  if (!verbosity.ok) {
    return verbosity;
  }

  const format = readReportFormatEnv(env);
  if (!format.ok) {
    return format;
  }

  const { invalid: invalidStyle, styles } = resolveOutputStyles(options);
  if (invalidStyle !== undefined) {
    return { ok: false, error: describeInvalidOutputStyle(invalidStyle) };
  }

  return { ok: true, format: format.format, styles, verbosity: verbosity.verbosity };
}

/**
 * Reports an invocation's verdict, unless the levels around it already report for it.
 *
 * A hook leaf reports none: it is not a command that anyone asked for, but part of the chain on which the level
 * that wrapped it reports, and a line here would say the same thing twice under a different name. A delegating
 * invocation returns before composing a verdict, and every scope to which it fans out reports its own.
 */
export function reportVerdict(verdict: Verdict, stdout: Writable, format: ReportFormat, style: OutputStyle): void {
  if (isHookName(verdict.command)) {
    return;
  }
  writeVerdict(verdict, stdout, format, style);
}

/**
 * Resolves how loudly this run reports the output of the commands that it runs.
 *
 * A machine-readable run reports on stdout and nothing else may, so it withholds that output whatever the
 * loudness ladder would have resolved to. A failure still prints it on stderr, as under any quiet run. Because the
 * two leave the child on the same channels, a machine-readable run and a quiet one share a retention key.
 */
export function resolveReportingVerbosity(
  options: ResolveVerbosityOptions & { format: ReportFormat },
): CommandVerbosity {
  const { format, ...ladder } = options;

  return format === 'json' ? 'quiet' : resolveVerbosity(ladder);
}

// region | Helpers

/** What the presentation sources came to, or the message naming why one of them could not be read. */
type PresentationRead =
  | { ok: true; format: ReportFormat | undefined; styles: StreamStyles; verbosity: CommandVerbosity | undefined }
  | { ok: false; error: string };

// endregion | Helpers
