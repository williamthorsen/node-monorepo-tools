import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';
import { defineCommand, runCli } from '@williamthorsen/nmr-core/cli';

import { DEFAULT_HOOK, ensurePrepublishHooks, reportPrepublishHooks } from './commands/ensure-prepublish-hooks.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';
import { findMonorepoRoot } from './workspace.ts';

const command = defineCommand({
  summary: 'Check that every publishable workspace package has a prepublishOnly script',
  flags: {
    fix: { type: 'boolean', description: 'Add the script to each publishable package that lacks it' },
    dryRun: { type: 'boolean', description: 'With --fix, report the packages that it would change without writing' },
    command: {
      type: 'string',
      description: `The command that the script runs (default: ${DEFAULT_HOOK})`,
      valueHint: 'command',
    },
  },
  run: ({ flags }) => {
    // Resolve the styles ahead of the work, so that a variable that does not name a style is rejected before `--fix`
    // writes anything.
    const styles = resolveBinStyles();
    const options = { shouldFix: flags.fix, isDryRun: flags.dryRun, ...(flags.command && { command: flags.command }) };
    const result = ensurePrepublishHooks(findMonorepoRoot(), options);

    reportPrepublishHooks(result, flags.command ?? DEFAULT_HOOK, styles.stdout);

    return result.hasFailures ? 1 : 0;
  },
});

try {
  process.exitCode = await runCli(process.argv.slice(2), command, {
    name: 'ensure-prepublish-hooks',
    stdout: process.stdout,
    stderr: process.stderr,
  });
} catch (error: unknown) {
  reportFailure('ensure-prepublish-hooks', error);
  process.exitCode = 1;
}
