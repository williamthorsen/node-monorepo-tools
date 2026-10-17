#!/usr/bin/env node
/* eslint n/hashbang: off, n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */
// The command dispatch is a flat sequence of `process.exit(0)` guards, which the rule treats as
// fall-through.
/* eslint unicorn/prefer-else-if: "off" */

import { parseArgsOrExit, reportError, resolveSelfVersion } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { commitCommand } from '../commitCommand.ts';
import { configFlagSchema } from '../configFlagSchema.ts';
import { createGithubReleaseCommand } from '../createGithubReleaseCommand.ts';
import { enterRepoRoot, type RepoLocation } from '../enterRepoRoot.ts';
import { showInitHelp, showUpdateTemplatesHelp } from '../help/initHelp.ts';
import { showOverridesHelp, showOverridesValidateHelp } from '../help/overridesHelp.ts';
import { showPrepareHelp } from '../help/prepareHelp.ts';
import {
  showCommitHelp,
  showCreateGithubReleaseHelp,
  showPublishHelp,
  showPushHelp,
  showShowTagPrefixesHelp,
  showTagHelp,
} from '../help/releaseStepsHelp.ts';
import {
  showSyncLabelsGenerateHelp,
  showSyncLabelsHelp,
  showSyncLabelsInitHelp,
  showSyncLabelsSyncHelp,
} from '../help/syncLabelsHelp.ts';
import { showUsage } from '../help/usage.ts';
import { initCommand } from '../init/initCommand.ts';
import { updateTemplatesCommand } from '../init/updateTemplatesCommand.ts';
import { prepareCommand } from '../prepareCommand.ts';
import { publishCommand } from '../publishCommand.ts';
import { pushCommand } from '../pushCommand.ts';
import { resolveConfigFlag } from '../resolveConfigFlag.ts';
import { resolveStylesOrExit } from '../resolveStylesOrExit.ts';
import { showTagPrefixesCommand } from '../showTagPrefixesCommand.ts';
import { generateCommand } from '../sync-labels/generateCommand.ts';
import { syncLabelsInitCommand } from '../sync-labels/initCommand.ts';
import { syncLabelsCommand } from '../sync-labels/syncCommand.ts';
import { tagCommand } from '../tagCommand.ts';
import { validateOverridesCommand } from '../validateOverridesCommand.ts';

const VERSION = resolveSelfVersion(import.meta.url);

/** Moves the process to the repo root, or reports why none was found and exits. */
function enterRepoRootOrExit(): RepoLocation {
  try {
    return enterRepoRoot();
  } catch (error: unknown) {
    reportError(describeError(error));
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const command = args[0];

if (command === '--version' || command === '-V') {
  console.info(VERSION);
  process.exit(0);
}

if (command === undefined || ['--help', '-h'].includes(command)) {
  showUsage();
  process.exit(0);
}

const flags = args.slice(1);

const styles = resolveStylesOrExit({
  env: process.env,
  stderrIsTty: process.stderr.isTTY,
  stdoutIsTty: process.stdout.isTTY,
});

if (command === 'prepare') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showPrepareHelp();
    process.exit(0);
  }

  const { invocationDir } = enterRepoRootOrExit();

  await prepareCommand(flags, styles, invocationDir);
  process.exit(0);
}

if (command === 'commit') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showCommitHelp();
    process.exit(0);
  }

  enterRepoRootOrExit();

  try {
    commitCommand(flags);
  } catch (error: unknown) {
    reportError(describeError(error));
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'tag') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showTagHelp();
    process.exit(0);
  }

  enterRepoRootOrExit();

  tagCommand(flags, styles);
  process.exit(0);
}

if (command === 'push') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showPushHelp();
    process.exit(0);
  }

  const { invocationDir } = enterRepoRootOrExit();

  await pushCommand(flags, styles, invocationDir);
  process.exit(0);
}

if (command === 'create-github-release') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showCreateGithubReleaseHelp();
    process.exit(0);
  }

  const { invocationDir } = enterRepoRootOrExit();

  await createGithubReleaseCommand(flags, styles, invocationDir);
  process.exit(0);
}

if (command === 'publish') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showPublishHelp();
    process.exit(0);
  }

  const { invocationDir } = enterRepoRootOrExit();

  await publishCommand(flags, styles, invocationDir);
  process.exit(0);
}

if (command === 'show-tag-prefixes') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showShowTagPrefixesHelp();
    process.exit(0);
  }

  const { invocationDir } = enterRepoRootOrExit();

  const { config } = parseArgsOrExit(flags, configFlagSchema).flags;
  const exitCode = await showTagPrefixesCommand(styles, resolveConfigFlag(config, invocationDir));
  process.exit(exitCode);
}

if (command === 'init') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showInitHelp();
    process.exit(0);
  }

  enterRepoRootOrExit();

  const initFlagSchema = {
    dryRun: { long: '--dry-run', type: 'boolean' as const },
    force: { long: '--force', type: 'boolean' as const },
    withConfig: { long: '--with-config', type: 'boolean' as const },
  };

  const { dryRun, force, withConfig } = parseArgsOrExit(flags, initFlagSchema).flags;
  const exitCode = initCommand({ dryRun, force, styles, withConfig });
  process.exit(exitCode);
}

if (command === 'update-templates') {
  if (flags.some((f) => f === '--help' || f === '-h')) {
    showUpdateTemplatesHelp();
    process.exit(0);
  }

  enterRepoRootOrExit();

  const updateTemplatesFlagSchema = {
    dryRun: { long: '--dry-run', type: 'boolean' as const },
  };

  const { dryRun } = parseArgsOrExit(flags, updateTemplatesFlagSchema).flags;
  const exitCode = updateTemplatesCommand({ dryRun, styles });
  process.exit(exitCode);
}

if (command === 'sync-labels') {
  const subcommand = flags[0];

  if (subcommand === undefined || ['--help', '-h'].includes(subcommand)) {
    showSyncLabelsHelp();
    process.exit(0);
  }

  const subflags = flags.slice(1);

  if (subcommand === 'init') {
    if (subflags.some((f) => f === '--help' || f === '-h')) {
      showSyncLabelsInitHelp();
      process.exit(0);
    }

    const { invocationDir } = enterRepoRootOrExit();

    const syncLabelsInitFlagSchema = {
      ...configFlagSchema,
      dryRun: { long: '--dry-run', type: 'boolean' as const },
      force: { long: '--force', type: 'boolean' as const },
    };

    const { config, dryRun, force } = parseArgsOrExit(subflags, syncLabelsInitFlagSchema).flags;
    const configPath = resolveConfigFlag(config, invocationDir);
    const exitCode = await syncLabelsInitCommand({
      ...(configPath !== undefined && { configPath }),
      dryRun,
      force,
      styles,
    });
    process.exit(exitCode);
  }

  if (subcommand === 'generate') {
    if (subflags.some((f) => f === '--help' || f === '-h')) {
      showSyncLabelsGenerateHelp();
      process.exit(0);
    }

    const { invocationDir } = enterRepoRootOrExit();

    const generateFlagSchema = {
      ...configFlagSchema,
      check: { long: '--check', type: 'boolean' as const },
    };

    const { check, config } = parseArgsOrExit(subflags, generateFlagSchema).flags;
    const configPath = resolveConfigFlag(config, invocationDir);
    const exitCode = await generateCommand({ check, ...(configPath !== undefined && { configPath }), styles });
    process.exit(exitCode);
  }

  if (subcommand === 'sync') {
    if (subflags.some((f) => f === '--help' || f === '-h')) {
      showSyncLabelsSyncHelp();
      process.exit(0);
    }

    if (subflags.length > 0) {
      reportError(`Unknown option: ${subflags[0]}`);
      process.exit(1);
    }

    enterRepoRootOrExit();

    const exitCode = syncLabelsCommand();
    process.exit(exitCode);
  }

  reportError(`Unknown subcommand: ${subcommand}`);
  showSyncLabelsHelp();
  process.exit(1);
}

if (command === 'overrides') {
  const subcommand = flags[0];

  if (subcommand === undefined || ['--help', '-h'].includes(subcommand)) {
    showOverridesHelp();
    process.exit(0);
  }

  const subflags = flags.slice(1);

  if (subcommand === 'validate') {
    if (subflags.some((f) => f === '--help' || f === '-h')) {
      showOverridesValidateHelp();
      process.exit(0);
    }

    const { invocationDir } = enterRepoRootOrExit();

    const { config } = parseArgsOrExit(subflags, configFlagSchema).flags;
    const result = await validateOverridesCommand(styles, resolveConfigFlag(config, invocationDir));
    if (result.exitCode === 0) {
      console.info(result.message);
    } else {
      process.stderr.write(`${result.message}\n`);
    }
    process.exit(result.exitCode);
  }

  reportError(`Unknown subcommand: ${subcommand}`);
  showOverridesHelp();
  process.exit(1);
}

reportError(`Unknown command: ${command}`);
showUsage();
process.exit(1);
