import type { RepoLabelsConfig } from '../configSchema.ts';
import { loadPreset } from './presets.ts';
import type { LabelDefinition } from './types.ts';

/**
 * Resolves the repository's label set from a `repoLabels` config block.
 *
 * Resolution is an ordered fold with last-writer-wins: Presets are loaded in `extends` order (a later preset replaces
 * an earlier preset's label of the same name), then the `labels` record is applied: An entry adds a label, replaces
 * one that an earlier layer defined, or removes it (`null`). Names match case-insensitively, as GitHub matches them,
 * and the replacing layer's spelling becomes the label's name. Replacement is wholesale, so an entry omitting
 * `description` drops the one that an earlier layer supplied rather than inheriting it.
 * Throws on three misstatements that the output diff would otherwise not show: keys in the `labels` record that differ
 * only in case, all but one of which the fold would discard; a dangling `null`, a removal naming a label that the
 * `extends` presets did not define; and an alias that names a resolved label or repeats another alias, which makes
 * `github-label-sync` merge one label into another and delete it.
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

  const resolvedLabels = new Map<string, LabelDefinition>();

  const presetNames = config.extends ?? [];
  for (const presetName of presetNames) {
    for (const label of loadPreset(presetName)) {
      resolvedLabels.set(getLabelKey(label.name), label);
    }
  }

  for (const [name, spec] of labelEntries) {
    const key = getLabelKey(name);
    if (spec === null) {
      if (!resolvedLabels.has(key)) {
        throw new Error(
          `Label '${name}' is set to null (remove), but the presets in 'extends' don't define it. Fix the name or delete the entry.`,
        );
      }
      resolvedLabels.delete(key);
    } else {
      // Spread the optional fields conditionally: Zod infers an optional field as `T | undefined`,
      // which `exactOptionalPropertyTypes` rejects for an optional property.
      resolvedLabels.set(key, {
        name,
        color: spec.color,
        ...(spec.description !== undefined && { description: spec.description }),
        ...(spec.aliases !== undefined && { aliases: spec.aliases }),
        ...(spec.archived !== undefined && { archived: spec.archived }),
      });
    }
  }

  const labels = sortLabels(resolvedLabels.values().toArray());

  const aliasCollisions = findAliasCollisions(labels);
  if (aliasCollisions.length > 0) {
    throw new Error(
      `Aliases must name labels that are not declared and must not repeat, or the sync merges one label into another and deletes it: ${aliasCollisions.join('; ')}.`,
    );
  }

  return labels;
}

// region | Helpers

/** Describes each alias that matches a resolved label's name or an alias declared earlier. */
function findAliasCollisions(labels: LabelDefinition[]): string[] {
  const labelNamesByKey = new Map(labels.map((label) => [getLabelKey(label.name), label.name]));
  const aliasOwnersByKey = new Map<string, string>();
  const collisions: string[] = [];

  for (const label of labels) {
    const aliases = label.aliases ?? [];
    for (const alias of aliases) {
      const key = getLabelKey(alias);
      const namedLabel = labelNamesByKey.get(key);
      const earlierOwner = aliasOwnersByKey.get(key);
      if (namedLabel !== undefined) {
        collisions.push(`'${label.name}' declares alias '${alias}', which names the label '${namedLabel}'`);
      } else if (earlierOwner !== undefined) {
        collisions.push(`'${label.name}' declares alias '${alias}', which '${earlierOwner}' also declares`);
      } else {
        aliasOwnersByKey.set(key, label.name);
      }
    }
  }

  return collisions;
}

/** Groups names that share a label key, keeping only the groups of two or more. */
function findCaseVariantGroups(names: string[]): string[][] {
  return Map.groupBy(names, getLabelKey)
    .values()
    .filter((group) => group.length > 1)
    .toArray();
}

/** Returns the key that identifies a label name, compared case-insensitively as GitHub and `github-label-sync` do. */
function getLabelKey(name: string): string {
  return name.toLowerCase();
}

/** Sorts labels alphabetically by name (case-insensitive). */
function sortLabels(labels: LabelDefinition[]): LabelDefinition[] {
  return labels.toSorted((a, b) => a.name.localeCompare(b.name));
}

// endregion | Helpers
