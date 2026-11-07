import type { StreamStyles } from '@williamthorsen/nmr-core';

import { loadUsableConfig } from './loadValidatedConfig.ts';
import { pushRelease } from './pushRelease.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';

export interface PushCommandOptions {
  configPath: string | undefined;
  isDryRun: boolean;
  /** The tag names that `--tags` selects, or `undefined` to push every release tag on HEAD. */
  tags: string[] | undefined;
  tagsOnly: boolean;
  styles: StreamStyles;
}

/**
 * Orchestrates the CLI `push` command: loads the config, resolves tags from HEAD, and pushes the release commit and
 * each tag individually.
 */
export async function pushCommand({ configPath, isDryRun, tags, tagsOnly, styles }: PushCommandOptions): Promise<void> {
  const userConfig = await loadUsableConfig(styles.stderr, configPath);

  const resolvedTags = resolveCommandTags(tags, userConfig);

  if (resolvedTags.length === 0) {
    return;
  }

  const prefix = isDryRun ? '[dry-run] Would push' : 'Pushing';
  if (!tagsOnly) {
    console.info(`${prefix} branch and ${resolvedTags.length} tag(s):`);
  } else {
    console.info(`${prefix} ${resolvedTags.length} tag(s):`);
  }
  for (const { tag } of resolvedTags) {
    console.info(`  ${tag}`);
  }

  const steps = pushRelease(resolvedTags, { isDryRun, tagsOnly });

  if (isDryRun) {
    for (const step of steps) {
      console.info(`[dry-run] ${step.command.join(' ')}`);
    }
  }
}
