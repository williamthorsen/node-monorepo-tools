import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors/candidate';

import { runCli } from './runCli.ts';
import { UserError } from './UserError.ts';

try {
  const { exitCode } = await runCli({
    args: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exitCode = exitCode;
} catch (error: unknown) {
  // A user error names the file to edit, so its message stands alone. Anything else is nmr's own fault, where
  // the stack is where a report has to start; `describeError` covers an Error without one and a thrown
  // non-Error alike.
  if (error instanceof UserError) {
    reportError(error.message);
  } else {
    const detail = error instanceof Error && error.stack !== undefined ? error.stack : describeError(error);
    process.stderr.write(`${detail}\n`);
  }
  process.exitCode = 1;
}
