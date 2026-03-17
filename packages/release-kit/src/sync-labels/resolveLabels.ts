import { loadPreset } from './presets.ts';
import type { LabelDefinition, SyncLabelsConfig } from './types.ts';

/**
 * Resolve all labels from a sync-labels config by loading presets and merging with custom labels.
 *
 * Presets are loaded in order and their labels are concatenated. Custom labels from the config
 * are appended after preset labels. Throws if any label name appears more than once across
 * presets and custom labels.
 */
export function resolveLabels(config: SyncLabelsConfig): LabelDefinition[] {
  const presetLabels: LabelDefinition[] = [];
  for (const presetName of config.presets ?? []) {
    const loaded = loadPreset(presetName);
    presetLabels.push(...loaded);
  }

  const customLabels = config.labels ?? [];

  detectCollisions(presetLabels, customLabels);

  // Sort alphabetically by name for stable output
  return sortLabels([...presetLabels, ...customLabels]);
}

/** Detect duplicate label names within presets and between preset and custom labels. Throws with a list of conflicts. */
function detectCollisions(presetLabels: LabelDefinition[], customLabels: LabelDefinition[]): void {
  // Check for duplicates within preset labels (e.g., two presets both define 'bug')
  const seenPresetNames = new Set<string>();
  const withinPresetDuplicates: string[] = [];
  for (const label of presetLabels) {
    if (seenPresetNames.has(label.name)) {
      withinPresetDuplicates.push(label.name);
    }
    seenPresetNames.add(label.name);
  }

  if (withinPresetDuplicates.length > 0) {
    throw new Error(
      `Label name collision within presets: the following labels are defined by multiple presets: ${withinPresetDuplicates.join(', ')}. Remove the duplicates or use different presets.`,
    );
  }

  // Check for collisions between preset and custom labels
  const conflicts: string[] = [];
  for (const label of customLabels) {
    if (seenPresetNames.has(label.name)) {
      conflicts.push(label.name);
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Label name collision: the following labels appear in both presets and custom labels: ${conflicts.join(', ')}. Remove duplicates from your custom labels or use a different name.`,
    );
  }
}

/** Sort labels alphabetically by name (case-insensitive). */
function sortLabels(labels: LabelDefinition[]): LabelDefinition[] {
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node 20+; engine target is >=18.17.0
  return [...labels].sort((a, b) => a.name.localeCompare(b.name));
}
