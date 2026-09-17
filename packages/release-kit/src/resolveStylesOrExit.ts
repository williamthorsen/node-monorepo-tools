/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import {
  describeInvalidOutputStyle,
  reportError,
  resolveStreamStyles,
  type StreamStyles,
} from '@williamthorsen/nmr-core';

/** The environment variable holding the caller's standing style preference: `auto`, `plain`, or `rich`. */
export const OUTPUT_STYLE_ENV_VAR = 'RELEASE_KIT_OUTPUT_STYLE';

export interface ResolveStylesOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stderrIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

/** Resolves the style of each output stream, exiting with a usage error when the variable names no setting. */
export function resolveStylesOrExit(options: ResolveStylesOptions): StreamStyles {
  const { invalid, styles } = resolveStreamStyles({ ...options, envVar: OUTPUT_STYLE_ENV_VAR });
  if (invalid !== undefined) {
    reportError(describeInvalidOutputStyle(invalid));
    process.exit(1);
  }
  return styles;
}
