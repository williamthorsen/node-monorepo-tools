/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import process from 'node:process';

import { runCli } from './runCli.ts';

try {
  const { exitCode } = await runCli({
    args: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exit(exitCode);
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
}
