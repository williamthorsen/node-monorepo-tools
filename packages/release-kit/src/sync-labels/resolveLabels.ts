import type { RepoLabelsConfig } from '../types.ts';
import { loadPreset } from './presets.ts';
import type { LabelDefinition } from './types.ts';

/**
 * Resolves the repository's label set from a `repoLabels` config block.
 *
 * Resolution is an ordered fold with last-writer-wins: presets are loaded in `extends` order (a later preset replaces
 * an earlier preset's label of the same name), then the `labels` record is applied: An entry adds a label, replaces
 * one an earlier layer defined, or removes it (`null`). Names match case-insensitively, as GitHub matches them, and the
 * replacing layer's spelling becomes the label's name. Replacement is wholesale, so an entry omitting `description`
 * drops the one an earlier layer supplied rather than inheriting it.
 * Throws on two misstatements that would otherwise leave no trace in the output diff: keys in the `labels` record that
 * differ only in case, all but one of which the fold would discard, and a dangling `null`, a removal naming a label that
 * no preset defined.
 */
export function resolveLabels(config: RepoLabelsConfig): LabelDefinition[] {
  const labelEntries = Object.entries(config.labels ?? {});

  const caseVariantGroups = findCaseVariantGroups(labelEntries.map(([name]) => name));
  if (caseVariantGroups.length > 0) {
    const groupList = caseVariantGroups.map((group) => group.map((name) => `'${name}'`).join(' and ')).join('; ');
    throw new Error(
      `Keys in 'labels' differ only in case, which GitHub treats as the same label: ${groupList}. Keep one entry per label.`,
    );
  }

  const resolved = new Map<string, LabelDefinition>();

  const presetNames = config.extends ?? [];
  for (const presetName of presetNames) {
    for (const label of loadPreset(presetName)) {
      resolved.set(toLabelKey(label.name), label);
    }
  }

  for (const [name, spec] of labelEntries) {
    const key = toLabelKey(name);
    if (spec === null) {
      if (!resolved.has(key)) {
        throw new Error(
          `Label '${name}' is set to null (remove), but no preset in 'extends' defines it. Fix the name or delete the entry.`,
        );
      }
      resolved.delete(key);
    } else {
      // Spread the description conditionally: Zod infers an optional field as `string |
      // undefined`, which `exactOptionalPropertyTypes` rejects for a `description?: string`.
      resolved.set(key, {
        name,
        color: spec.color,
        ...(spec.description !== undefined && { description: spec.description }),
      });
    }
  }

  return sortLabels(resolved.values().toArray());
}

// region | Helpers

/** Groups names that share a label key, keeping only the groups of two or more. */
function findCaseVariantGroups(names: string[]): string[][] {
  return Map.groupBy(names, toLabelKey)
    .values()
    .filter((group) => group.length > 1)
    .toArray();
}

/** Sorts labels alphabetically by name (case-insensitive). */
function sortLabels(labels: LabelDefinition[]): LabelDefinition[] {
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node 20+; engine target is >=18.17.0
  return [...labels].sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns the key that identifies a label name, compared case-insensitively as GitHub and `github-label-sync` do. */
function toLabelKey(name: string): string {
  return name.toLowerCase();
}

// endregion | Helpers
