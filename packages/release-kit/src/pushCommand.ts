/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgsOrExit, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { configFlagSchema } from './configFlagSchema.ts';
import { loadUsableConfig } from './loadValidatedConfig.ts';
import { parseRequestedTags } from './parseRequestedTags.ts';
import { pushRelease } from './pushRelease.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';
import { resolveConfigFlag } from './resolveConfigFlag.ts';

const pushFlagSchema = {
  ...configFlagSchema,
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  tags: { long: '--tags', type: 'string' as const },
  tagsOnly: { long: '--tags-only', type: 'boolean' as const },
};

/**
 * Orchestrate the CLI `push` command: parse flags, load the config, resolve tags from HEAD, and push
 * the release commit and each tag individually. A relative `--config` resolves against `invocationDir`.
 */
export async function pushCommand(argv: string[], styles: StreamStyles, invocationDir: string): Promise<void> {
  const parsed = parseArgsOrExit(argv, pushFlagSchema);
  const configPath = resolveConfigFlag(parsed.flags.config, invocationDir);

  const { dryRun, tagsOnly } = parsed.flags;

  const userConfig = await loadUsableConfig(styles.stderr, configPath);

  const requestedTags = parseRequestedTags(parsed.flags.tags);

  const resolvedTags = resolveCommandTags(requestedTags, userConfig);

  if (resolvedTags.length === 0) {
    return;
  }

  const prefix = dryRun ? '[dry-run] Would push' : 'Pushing';
  if (!tagsOnly) {
    console.info(`${prefix} branch and ${resolvedTags.length} tag(s):`);
  } else {
    console.info(`${prefix} ${resolvedTags.length} tag(s):`);
  }
  for (const { tag } of resolvedTags) {
    console.info(`  ${tag}`);
  }

  try {
    const steps = pushRelease(resolvedTags, { dryRun, tagsOnly });

    if (dryRun) {
      for (const step of steps) {
        console.info(`[dry-run] ${step.command.join(' ')}`);
      }
    }
  } catch (error: unknown) {
    reportError(describeError(error));
    process.exit(1);
  }
}
