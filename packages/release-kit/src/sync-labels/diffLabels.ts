import type { LabelDefinition } from './types.ts';

/** The labels that differ between two label lists, by name. */
export interface LabelDiff {
  added: string[];
  changed: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
}

/**
 * Compares two label lists by name and returns the labels added, removed, renamed, and changed.
 *
 * An added label whose `aliases` names a removed label is a rename of that label, because the sync renames it in
 * place. A label present in both lists is changed when its color, description, aliases, or archived flag differs.
 */
export function diffLabels(previous: readonly LabelDefinition[], next: readonly LabelDefinition[]): LabelDiff {
  const previousByName = new Map(previous.map((label) => [label.name, label]));
  const nextNames = new Set(next.map((label) => label.name));

  const added: string[] = [];
  const changed: string[] = [];
  const renamed: LabelDiff['renamed'] = [];
  const unmatchedRemovals = new Set(previous.map((label) => label.name).filter((name) => !nextNames.has(name)));

  for (const label of next) {
    const previousLabel = previousByName.get(label.name);
    if (previousLabel !== undefined) {
      if (!areLabelsEqual(previousLabel, label)) {
        changed.push(label.name);
      }
      continue;
    }

    const renamedFrom = label.aliases?.find((alias) => unmatchedRemovals.has(alias));
    if (renamedFrom === undefined) {
      added.push(label.name);
    } else {
      unmatchedRemovals.delete(renamedFrom);
      renamed.push({ from: renamedFrom, to: label.name });
    }
  }

  return { added, changed, removed: [...unmatchedRemovals], renamed };
}

/** Reports whether a diff contains any label difference. */
export function hasLabelDifferences(diff: LabelDiff): boolean {
  return diff.added.length + diff.changed.length + diff.removed.length + diff.renamed.length > 0;
}

// region | Helpers

/** Reports whether two labels with the same name declare the same properties. */
function areLabelsEqual(a: LabelDefinition, b: LabelDefinition): boolean {
  return (
    a.color === b.color &&
    a.description === b.description &&
    a.archived === b.archived &&
    (a.aliases ?? []).join('\n') === (b.aliases ?? []).join('\n')
  );
}

// endregion | Helpers
