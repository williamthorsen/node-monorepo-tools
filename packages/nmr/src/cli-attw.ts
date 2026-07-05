import { reportError } from '@williamthorsen/nmr-core';

import { runAttw } from './commands/attw.ts';

try {
  process.exitCode = runAttw({
    packageDir: process.cwd(),
    argv: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  });
} catch (error) {
  reportError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
