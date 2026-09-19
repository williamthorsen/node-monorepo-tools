import process from 'node:process';

import { describeInvalidOutputStyle, type StreamStyles } from '@williamthorsen/nmr-core';

import { resolveOutputStyles } from './output-style.ts';
import { UserError } from './UserError.ts';

/**
 * Resolves the style of the running process's own output streams, and rejects a variable naming no style.
 *
 * What a standalone bin calls. A bin carries no `--output-style` of its own: the flag is `nmr`'s, and what
 * reaches a bin is the variable that `nmr <command>` exports to it, so a bin run through nmr renders as nmr
 * does and one run on its own detects its streams.
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
