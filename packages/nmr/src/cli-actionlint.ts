import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { runActionlint } from './commands/actionlint.ts';
import { findMonorepoRoot } from './workspace.ts';

try {
  process.exitCode = await runActionlint(findMonorepoRoot(), process.argv.slice(2));
} catch (error: unknown) {
  reportError(describeError(error));
  process.exitCode = 1;
}
