/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgs, translateParseError } from '@williamthorsen/nmr-core';

import { parseRequestedTags } from './parseRequestedTags.ts';
import { pushRelease } from './pushRelease.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';

const pushFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  tags: { long: '--tags', type: 'string' as const },
  tagsOnly: { long: '--tags-only', type: 'boolean' as const },
};

/**
 * Orchestrate the CLI `push` command: parse flags, resolve tags from HEAD, and push
 * the release commit and each tag individually.
 */
export async function pushCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs(argv, pushFlagSchema);
  } catch (error: unknown) {
    console.error(`Error: ${translateParseError(error)}`);
    process.exit(1);
  }

  const { dryRun, tagsOnly } = parsed.flags;
  const requestedTags = parseRequestedTags(parsed.flags.tags);

  const resolvedTags = await resolveCommandTags(requestedTags);

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
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
