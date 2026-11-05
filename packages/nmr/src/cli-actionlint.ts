import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { runActionlint } from './commands/actionlint.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  process.exitCode = await runActionlint(findMonorepoRoot(), process.argv.slice(2));
} catch (error: unknown) {
  reportFailure('nmr-actionlint', error);
  process.exitCode = 1;
}
