import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { runFmt } from './commands/fmt.ts';

try {
  process.exitCode = await runFmt(process.argv.slice(2), process.cwd());
} catch (error: unknown) {
  reportFailure('nmr-fmt', error);
  process.exitCode = 1;
}
