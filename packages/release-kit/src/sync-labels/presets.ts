import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { load } from 'js-yaml';

import { findPackageRoot } from '../findPackageRoot.ts';
import { isRecord } from '../typeGuards.ts';
import type { LabelDefinition } from './types.ts';

/** Resolve a preset name to the path of its bundled YAML file. */
function resolvePresetPath(presetName: string): string {
  const root = findPackageRoot(import.meta.url);
  return resolve(root, 'presets', 'labels', `${presetName}.yaml`);
}

/** Compute SHA-256 hex digest of a preset file's raw content. Throws if the preset does not exist. */
export function hashPresetFile(presetName: string): string {
  const presetPath = resolvePresetPath(presetName);
  if (!existsSync(presetPath)) {
    throw new Error(`Unknown preset "${presetName}". No file found at ${presetPath}`);
  }
  const content = readFileSync(presetPath, 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Load a named preset from the bundled YAML files.
 *
 * Returns the parsed label definitions. Throws if the preset does not exist or has invalid content.
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
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read preset "${presetName}": ${message}`);
  }

  const parsed: unknown = load(content);
  if (!Array.isArray(parsed)) {
    throw new TypeError(`Preset "${presetName}" must be a YAML array of label definitions`);
  }

  const labels: LabelDefinition[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      throw new Error(`Preset "${presetName}" contains an invalid label entry: ${JSON.stringify(entry)}`);
    }
    if (typeof entry.name !== 'string' || typeof entry.color !== 'string' || typeof entry.description !== 'string') {
      throw new TypeError(`Preset "${presetName}" contains a label with invalid fields: ${JSON.stringify(entry)}`);
    }
    labels.push({ name: entry.name, color: entry.color, description: entry.description });
  }

  return labels;
}
