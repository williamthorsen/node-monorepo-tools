import type { StreamStyles } from '@williamthorsen/nmr-core';

import { createTags } from './createTags.ts';

export interface TagCommandOptions {
  isDryRun: boolean;
  shouldSkipGitChecks: boolean;
  styles: StreamStyles;
}

/** Runs the CLI `tag` command by delegating to `createTags`. */
export function tagCommand({ isDryRun, shouldSkipGitChecks, styles }: TagCommandOptions): void {
  createTags({ isDryRun, shouldSkipGitChecks, style: styles.stdout });
}
