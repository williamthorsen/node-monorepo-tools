import process from 'node:process';

import { describeError } from '@williamthorsen/toolbelt.errors/candidate';

import { runCli } from './runCli.ts';

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
  // The CLI boundary reports the stack when there is one; `describeError` covers an Error without one and a
  // thrown non-Error alike.
  const detail = error instanceof Error && error.stack !== undefined ? error.stack : describeError(error);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
}
