import type { Writable } from 'node:stream';

import { resolveStreamStyles, type StreamStyleResolution } from '@williamthorsen/nmr-core';

/**
 * Reports whether a stream is backed by a terminal, which detection reads when the flag and `NMR_OUTPUT_STYLE`
 * do not name a style. A stream without an `isTTY` property is not one.
 */
export function isTerminalStream(stream: Writable): boolean {
  return 'isTTY' in stream && stream.isTTY === true;
}

/**
 * Passes the resolved style down the spawned chain, so that the flag's value is available to every process rather
 * than the first and a child writing to a pipe renders as its parent does rather than detecting plain on its own
 * descriptor.
 *
 * Neither the pass key nor the retention key includes it: It changes how a run renders and never what a command
 * concludes, so a plain run can reuse a pass that a rich run recorded.
 */
export const OUTPUT_STYLE_ENV_VAR = 'NMR_OUTPUT_STYLE';

/**
 * The flag naming a style for one invocation, which outranks `OUTPUT_STYLE_ENV_VAR`.
 *
 * Only `nmr` accepts it. A standalone bin reads the variable, which `nmr <command>` exports to it.
 */
export const OUTPUT_STYLE_FLAG = '--output-style';

/**
 * Resolves the style of each output stream: the flag, then `NMR_OUTPUT_STYLE`, then detection from `CI`, the
 * stream's terminal state, and `TERM`.
 *
 * Never throws. A value that does not name any style is returned in `invalid`, for the caller to report with
 * `describeInvalidOutputStyle`, because the caller has to render that complaint in some style.
 *
 * Passes the flag's raw value to nmr-core unnarrowed, so that nmr rejects a misspelling in the same words as
 * its sibling CLIs.
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
  /** The value given to the flag, absent when the invocation omits the flag, as a bin's invocation always does. */
  flagValue?: string | undefined;
  stderrIsTty: boolean;
  stdoutIsTty: boolean;
}
