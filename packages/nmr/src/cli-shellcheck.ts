import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { runShellcheck } from './commands/shellcheck.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  process.exitCode = await runShellcheck(findMonorepoRoot(), process.argv.slice(2));
} catch (error: unknown) {
  reportFailure('nmr-shellcheck', error);
  process.exitCode = 1;
}
