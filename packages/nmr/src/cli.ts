import process from 'node:process';

import { reportCliFailure } from './reportCliFailure.ts';
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
  reportCliFailure(error, process.stderr);
  process.exitCode = 1;
}
