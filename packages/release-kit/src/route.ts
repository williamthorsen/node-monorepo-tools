import process from 'node:process';

import { resolveSelfVersion } from '@williamthorsen/nmr-core';
import { type CliStyleContext, createCli, resolveCliStyles, runCli } from '@williamthorsen/nmr-core/cli';

import { BIN } from './bin.ts';
import type { CommandContext } from './cli/commandKit.ts';
import { init, overrides, showTagPrefixes, syncLabels, updateTemplates } from './cli/maintenanceCommands.ts';
import { commit, createGithubRelease, prepare, publish, push, tag } from './cli/releaseCommands.ts';

const VERSION = resolveSelfVersion(import.meta.url);

/** The environment variable that sets the caller's standing style preference: `auto`, `plain`, or `rich`. */
const OUTPUT_STYLE_ENV_VAR = 'RELEASE_KIT_OUTPUT_STYLE';

/** Runs the `release-kit` command tree against the arguments and resolves to the exit code. */
export async function routeCommand(args: string[]): Promise<number> {
  return runCli(args, ROOT, {
    name: BIN,
    context: { env: process.env, stderrIsTty: process.stderr.isTTY, stdoutIsTty: process.stdout.isTTY },
    stdout: process.stdout,
    stderr: process.stderr,
    version: () => VERSION,
  });
}

const { defineGroup } = createCli<CliStyleContext>();

const ROOT = defineGroup({
  summary: 'Version-bumping and changelog-generation toolkit for release workflows',
  deriveContext: (_flags, context): CommandContext => ({
    styles: resolveCliStyles({ ...context, envVar: OUTPUT_STYLE_ENV_VAR }),
  }),
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
