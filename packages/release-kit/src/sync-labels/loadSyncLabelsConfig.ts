import { existsSync } from 'node:fs';
import path from 'node:path';

import { isRecord } from '../typeGuards.ts';
import type { SyncLabelsConfig } from './types.ts';

/** The path where the sync-labels config file is expected. */
export const SYNC_LABELS_CONFIG_PATH = '.config/sync-labels.config.ts';

/**
 * Load the sync-labels config file at `.config/sync-labels.config.ts` using jiti.
 *
 * Returns the typed config object, or `undefined` if the file does not exist.
 * Throws if the file exists but cannot be loaded or has an invalid shape.
 */
export async function loadSyncLabelsConfig(): Promise<SyncLabelsConfig | undefined> {
  const absoluteConfigPath = path.resolve(process.cwd(), SYNC_LABELS_CONFIG_PATH);

  if (!existsSync(absoluteConfigPath)) {
    return undefined;
  }

  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const imported: unknown = await jiti.import(absoluteConfigPath);

  if (!isRecord(imported)) {
    throw new Error(`Config file must export an object, got ${Array.isArray(imported) ? 'array' : typeof imported}`);
  }

  // Support both default export and named `config` export
  const resolved: unknown = imported.default ?? imported.config;
  if (resolved === undefined) {
    throw new Error(
      'Config file must have a default export or a named `config` export (e.g., `export default { ... }` or `export const config = { ... }`)',
    );
  }

  return validateSyncLabelsConfig(resolved);
}

/** Validate that a loaded value matches the expected SyncLabelsConfig shape and return a typed config. */
function validateSyncLabelsConfig(value: unknown): SyncLabelsConfig {
  if (!isRecord(value)) {
    throw new Error(`Config must be an object, got ${typeof value}`);
  }

  let presets: string[] | undefined;
  if (value.presets !== undefined) {
    if (!Array.isArray(value.presets) || !value.presets.every((p): p is string => typeof p === 'string')) {
      throw new Error('Config `presets` must be an array of strings');
    }
    presets = value.presets;
  }

  let labels: Array<{ name: string; color: string; description: string }> | undefined;
  if (value.labels !== undefined) {
    if (!Array.isArray(value.labels)) {
      throw new TypeError('Config `labels` must be an array');
    }
    labels = [];
    for (const label of value.labels) {
      if (!isRecord(label)) {
        throw new Error('Each label must be an object with `name`, `color`, and `description`');
      }
      if (typeof label.name !== 'string' || typeof label.color !== 'string' || typeof label.description !== 'string') {
        throw new TypeError('Each label must have string `name`, `color`, and `description` fields');
      }
      labels.push({ name: label.name, color: label.color, description: label.description });
    }
  }

  return {
    ...(presets !== undefined && { presets }),
    ...(labels !== undefined && { labels }),
  };
}
