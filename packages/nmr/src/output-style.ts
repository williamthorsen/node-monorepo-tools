import type { Writable } from 'node:stream';

import { resolveStreamStyles, type StreamStyleResolution } from '@williamthorsen/nmr-core';

/**
 * Reports whether a stream is backed by a terminal, which is what detection reads where no source names a
 * style. A stream carrying no `isTTY`, which is the one a test injects, is not one.
 */
export function isTerminalStream(stream: Writable): boolean {
  return 'isTTY' in stream && stream.isTTY === true;
}

/**
 * Carries the resolved style down the spawned chain, so the flag reaches every process rather than the first
 * and a child writing to a pipe renders as its parent does rather than detecting plain on its own descriptor.
 *
 * Deliberately not a keyed variable, on neither the pass key nor the retention key: it changes how a run
 * renders and never what a command concludes, so folding it into either would stop a plain run from hitting a
 * pass a rich one recorded.
 */
export const OUTPUT_STYLE_ENV_VAR = 'NMR_OUTPUT_STYLE';

/**
 * The flag naming a style for one invocation, which outranks `OUTPUT_STYLE_ENV_VAR`.
 *
 * `nmr` alone carries it. A standalone bin takes the variable, which `nmr <command>` exports to it, so adding
 * a style to a bin does not mean adding a flag to each bin's own parser.
 */
export const OUTPUT_STYLE_FLAG = '--output-style';

/**
 * Resolves the style of each output stream: the flag, then `NMR_OUTPUT_STYLE`, then detection from `CI`, the
 * stream's terminal state, and `TERM`.
 *
 * Never throws. A value naming no style is returned in `invalid`, for the caller to report with
 * `describeInvalidOutputStyle`, because the caller has to render that complaint in some style.
 *
 * The flag's raw value is handed to nmr-core as an assignment rather than narrowed here, so nmr rejects a
 * misspelling in the words its siblings use and no second ladder can come to name a different one.
 */
export function resolveOutputStyles(options: ResolveOutputStylesOptions): StreamStyleResolution {
  const { env, flagValue, stderrIsTty, stdoutIsTty } = options;

  return resolveStreamStyles({
    argv: flagValue === undefined ? [] : [`${OUTPUT_STYLE_FLAG}=${flagValue}`],
    env,
    envVar: OUTPUT_STYLE_ENV_VAR,
    flag: OUTPUT_STYLE_FLAG,
    stderrIsTty,
    stdoutIsTty,
  });
}

export interface ResolveOutputStylesOptions {
  env: NodeJS.ProcessEnv;
  /** The value the flag was given, absent where the invocation carries none, as a bin's invocation always does. */
  flagValue?: string | undefined;
  stderrIsTty: boolean;
  stdoutIsTty: boolean;
}
