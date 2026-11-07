import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_FMT_BIN } from './bins.ts';
import { runFmt } from './commands/fmt.ts';

try {
  process.exitCode = await runFmt(process.argv.slice(2), process.cwd());
} catch (error: unknown) {
  reportFailure(NMR_FMT_BIN, error);
  process.exitCode = 1;
}
