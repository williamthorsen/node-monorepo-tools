import { isAnticipatedFailure, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import type { FlagSchema } from '@williamthorsen/nmr-core/cli';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { BIN } from '../bin.ts';
import { ConfigProblemError, reportConfigProblem } from '../loadValidatedConfig.ts';

/** The context that every `release-kit` command receives from the root group. */
export interface CommandContext {
  styles: StreamStyles;
}

/** The `--config` flag of every command that reads the config file. */
export const CONFIG_FLAG = {
  config: {
    type: 'path',
    description:
      'Config file, relative to the current directory (default: .config/release-kit.config.ts at the repo root)',
    valueHint: 'path',
  },
} satisfies FlagSchema;

/**
 * Runs a command and resolves to its exit code, 0 when it returns nothing. Reports an unusable config in its own form
 * and any other anticipated failure as `<bin>: <message>`, each with exit code 1, and rethrows anything else.
 */
export async function runReportingFailures(
  styles: StreamStyles,
  runCommand: () => number | undefined | Promise<number | undefined>,
): Promise<number> {
  try {
    return (await runCommand()) ?? 0;
  } catch (error: unknown) {
    if (error instanceof ConfigProblemError) {
      reportConfigProblem(error.problem, styles.stderr);
      return 1;
    }
    if (!isAnticipatedFailure(error)) {
      throw error;
    }
    reportError(BIN, describeError(error));
    return 1;
  }
}
