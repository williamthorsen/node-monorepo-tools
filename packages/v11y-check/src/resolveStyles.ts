import { describeInvalidOutputStyle, resolveStreamStyles, type StreamStyles } from '@williamthorsen/nmr-core';
import { UsageError } from '@williamthorsen/nmr-core/cli';

/** The environment variable that sets the caller's standing style preference: `auto`, `plain`, or `rich`. */
export const OUTPUT_STYLE_ENV_VAR = 'V11Y_CHECK_OUTPUT_STYLE';

export interface ResolveStylesOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stderrIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

/** Resolves the style of each output stream, throwing a `UsageError` when the variable doesn't name a setting. */
export function resolveStyles(options: ResolveStylesOptions): StreamStyles {
  const { invalid, styles } = resolveStreamStyles({ ...options, envVar: OUTPUT_STYLE_ENV_VAR });
  if (invalid !== undefined) {
    throw new UsageError(describeInvalidOutputStyle(invalid));
  }
  return styles;
}
