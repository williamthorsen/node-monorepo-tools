import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_BIN } from './bins.ts';
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
  reportFailure(NMR_BIN, error);
  process.exitCode = 1;
}
