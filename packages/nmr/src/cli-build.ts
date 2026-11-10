// Every package's `prepare` runs this file under bare `node`, so this module and everything in its import closure
// must be erasable TypeScript. pnpm can run some `prepare` scripts before nmr-core is built: nmr-core's own, and
// that of any package that does not depend on nmr-core. Each passes `--conditions nmr-source`, which lets the
// compiler import `@williamthorsen/nmr-core` before nmr-core's own `dist` exists.

import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_COMPILE_BIN } from './bins.ts';
import { runCompile } from './commands/compile.ts';

try {
  // `nmr-compile` always runs with the package directory as its working directory, which therefore contains the
  // package's own config.
  process.exitCode = await runCompile(process.argv.slice(2), process.cwd());
} catch (error: unknown) {
  reportFailure(NMR_COMPILE_BIN, error);
  process.exitCode = 1;
}
