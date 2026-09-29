import { existsSync } from 'node:fs';

import { reportError } from '@williamthorsen/nmr-core';

import { CONFIG_FILE_PATH } from '../loadConfig.ts';

/** Path of the retired standalone sync-labels config file. */
export const RETIRED_SYNC_LABELS_CONFIG_PATH = '.config/sync-labels.config.ts';

/**
 * Reports an actionable migration error when the retired standalone config file is present.
 *
 * Returns `true` when the file exists, in which case the caller must abort. The check is
 * unconditional on config content: File presence alone triggers it, so a half-migrated
 * repo cannot silently lose its custom labels. `configPath` names the config into which the
 * message directs the labels.
 */
export function checkRetiredSyncLabelsConfig(configPath: string = CONFIG_FILE_PATH): boolean {
  if (!existsSync(RETIRED_SYNC_LABELS_CONFIG_PATH)) {
    return false;
  }
  reportError(
    `${RETIRED_SYNC_LABELS_CONFIG_PATH} is no longer read. Move its labels into the \`repoLabels\` block of ${configPath} (presets move to \`repoLabels.extends\`; each label becomes a \`'name': { color, description }\` entry under \`repoLabels.labels\`), then delete the file.`,
  );
  return true;
}
