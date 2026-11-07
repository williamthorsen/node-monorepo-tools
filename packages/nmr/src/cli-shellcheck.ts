import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { NMR_SHELLCHECK_BIN } from './bins.ts';
import { runShellcheck } from './commands/shellcheck.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  process.exitCode = await runShellcheck(findMonorepoRoot(), process.argv.slice(2));
} catch (error: unknown) {
  reportFailure(NMR_SHELLCHECK_BIN, error);
  process.exitCode = 1;
}
