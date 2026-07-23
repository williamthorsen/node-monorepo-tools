import type { RepoLabelsConfig } from '../types.ts';
import { loadPreset } from './presets.ts';
import type { LabelDefinition } from './types.ts';

/**
 * Resolve the repository's label set from a `repoLabels` config block.
 *
 * Resolution is an ordered fold with last-writer-wins: presets are loaded in `extends`
 * order (a later preset replaces an earlier preset's label of the same name), then the
 * `labels` record is applied — an entry adds a label, replaces one an earlier layer
 * defined, or removes it (`null`). Throws only on a dangling `null`: a removal naming a
 * label no preset defined, which is a stale reference that would otherwise produce no
 * output diff to review.
 */
export function resolveLabels(config: RepoLabelsConfig): LabelDefinition[] {
  const resolved = new Map<string, LabelDefinition>();

  for (const presetName of config.extends ?? []) {
    for (const label of loadPreset(presetName)) {
      resolved.set(label.name, label);
    }
  }

  for (const [name, spec] of Object.entries(config.labels ?? {})) {
    if (spec === null) {
      if (!resolved.has(name)) {
        throw new Error(
          `Label '${name}' is set to null (remove), but no preset in 'extends' defines it. Fix the name or delete the entry.`,
        );
      }
      resolved.delete(name);
    } else {
      resolved.set(name, { name, color: spec.color, description: spec.description });
    }
  }

  return sortLabels([...resolved.values()]);
}

/** Sort labels alphabetically by name (case-insensitive). */
function sortLabels(labels: LabelDefinition[]): LabelDefinition[] {
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node 20+; engine target is >=18.17.0
  return [...labels].sort((a, b) => a.name.localeCompare(b.name));
}
