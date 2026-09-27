import process from 'node:process';

import { describeInvalidOutputStyle, type StreamStyles } from '@williamthorsen/nmr-core';

import { resolveOutputStyles } from './output-style.ts';
import { UserError } from './UserError.ts';

/**
 * Resolves the style of the running process's own output streams, and rejects a variable naming no style.
 *
 * Each standalone bin calls this and passes no flag value, because only `nmr` accepts `OUTPUT_STYLE_FLAG`.
 *
 * Throws rather than exiting, so the bin's own boundary reports the message and sets the exit code, as it does
 * for every other failure in what the caller declared.
 */
export function resolveBinStyles(): StreamStyles {
  const { invalid: invalidStyle, styles } = resolveOutputStyles({
    env: process.env,
    flagValue: undefined,
    stderrIsTty: process.stderr.isTTY,
    stdoutIsTty: process.stdout.isTTY,
  });
  if (invalidStyle !== undefined) {
    throw new UserError(describeInvalidOutputStyle(invalidStyle));
  }

  return styles;
}
