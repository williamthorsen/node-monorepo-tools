import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CANONICAL_TAXONOMY } from '@williamthorsen/change-grammar';
import { findPackageRoot } from '@williamthorsen/nmr-core';
import { chainError } from '@williamthorsen/toolbelt.errors/candidate';
import { parse } from 'yaml';

import { isRecord } from '../typeGuards.ts';
import { deriveTypeLabels } from './typeLabels.ts';
import type { LabelDefinition } from './types.ts';

/** The preset that defines a label for every work type in the taxonomy, ahead of the labels in its YAML file. */
const TYPE_LABELS_PRESET = 'common';

/** Computes the SHA-256 hex digest of a preset's resolved labels. Throws as `loadPreset` does. */
export function hashPreset(presetName: string): string {
  return createHash('sha256')
    .update(JSON.stringify(loadPreset(presetName)))
    .digest('hex');
}

/**
 * Loads a named preset from the bundled YAML files. The `common` preset also defines the label of every work type in
 * change-grammar's taxonomy, ahead of the labels in its file.
 *
 * Throws if the preset does not exist or has invalid content.
 */
export function loadPreset(presetName: string): LabelDefinition[] {
  const presetPath = resolvePresetPath(presetName);

  if (!existsSync(presetPath)) {
    throw new Error(`Unknown preset "${presetName}". No file found at ${presetPath}`);
  }

  let content: string;
  try {
    content = readFileSync(presetPath, 'utf8');
  } catch (error: unknown) {
    throw chainError(`Failed to read preset "${presetName}"`, error);
  }

  const parsed: unknown = parse(content);
  if (!Array.isArray(parsed)) {
    throw new TypeError(`Preset "${presetName}" must be a YAML array of label definitions`);
  }

  const labels: LabelDefinition[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      throw new Error(`Preset "${presetName}" contains an invalid label entry: ${JSON.stringify(entry)}`);
    }
    // `description` is optional here as it is in the `repoLabels.labels` record,
    // so that a preset can ship bare labels rather than restating each name.
    const { color, description, name } = entry;
    if (
      typeof name !== 'string' ||
      typeof color !== 'string' ||
      (description !== undefined && typeof description !== 'string')
    ) {
      throw new TypeError(`Preset "${presetName}" contains a label with invalid fields: ${JSON.stringify(entry)}`);
    }
    labels.push({ name, color, ...(description !== undefined && { description }) });
  }

  return presetName === TYPE_LABELS_PRESET ? [...deriveTypeLabels(CANONICAL_TAXONOMY), ...labels] : labels;
}

// region | Helpers

/** Resolves a preset name to the path of its bundled YAML file. */
function resolvePresetPath(presetName: string): string {
  const root = findPackageRoot(import.meta.url);
  return resolve(root, 'presets', 'labels', `${presetName}.yaml`);
}

// endregion | Helpers
