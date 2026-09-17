import {
  describeInvalidOutputStyle,
  reportError,
  resolveStreamStyles,
  type StreamStyles,
} from '@williamthorsen/nmr-core';

/** The environment variable holding the caller's standing style preference: `auto`, `plain`, or `rich`. */
export const OUTPUT_STYLE_ENV_VAR = 'V11Y_CHECK_OUTPUT_STYLE';

export interface ResolveStylesOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stderrIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

/** Resolves the style of each output stream, reporting a usage error and returning `undefined` when the variable names no setting. */
export function resolveStyles(options: ResolveStylesOptions): StreamStyles | undefined {
  const { invalid, styles } = resolveStreamStyles({ ...options, envVar: OUTPUT_STYLE_ENV_VAR });
  if (invalid !== undefined) {
    reportError(describeInvalidOutputStyle(invalid));
    return undefined;
  }
  return styles;
}
