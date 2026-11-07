import process from 'node:process';

import { resolveSelfVersion } from '@williamthorsen/nmr-core';
import { createCli, runCli } from '@williamthorsen/nmr-core/cli';

import type { CommandContext } from './cli/commandKit.ts';
import { init, overrides, showTagPrefixes, syncLabels, updateTemplates } from './cli/maintenanceCommands.ts';
import { commit, createGithubRelease, prepare, publish, push, tag } from './cli/releaseCommands.ts';
import { OUTPUT_STYLE_ENV_VAR, resolveStyles, type ResolveStylesOptions } from './resolveStyles.ts';

const VERSION = resolveSelfVersion(import.meta.url);

/** Runs the `release-kit` command tree against the arguments and resolves to the exit code. */
export async function routeCommand(args: string[]): Promise<number> {
  return runCli(args, ROOT, {
    name: 'release-kit',
    context: { env: process.env, stderrIsTty: process.stderr.isTTY, stdoutIsTty: process.stdout.isTTY },
    stdout: process.stdout,
    stderr: process.stderr,
    version: () => VERSION,
  });
}

const { defineGroup } = createCli<ResolveStylesOptions>();

const ROOT = defineGroup({
  summary: 'Version-bumping and changelog-generation toolkit for release workflows',
  deriveContext: (_flags, context): CommandContext => ({ styles: resolveStyles(context) }),
  commands: {
    prepare,
    commit,
    tag,
    push,
    publish,
    'create-github-release': createGithubRelease,
    'show-tag-prefixes': showTagPrefixes,
    init,
    'update-templates': updateTemplates,
    overrides,
    'sync-labels': syncLabels,
  },
  epilog: `Environment:
  ${OUTPUT_STYLE_ENV_VAR}
      Output style: auto (default), plain, or rich. auto prints plain, without emoji,
      when CI is set or the stream is not a terminal.`,
});
