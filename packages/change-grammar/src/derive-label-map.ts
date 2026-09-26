import { ROOT_SCOPE } from './tokens.ts';
import type { CanonicalWorkTypeEntry } from './types.ts';

/**
 * Maps each work type to its tracker label and each workspace to its scope label, in the order given. `root` joins the
 * scopes only when there is a workspace for it to stand apart from.
 */
export function deriveLabelMap(
  taxonomy: { types: readonly Pick<CanonicalWorkTypeEntry, 'key' | 'trackerLabel'>[] },
  workspaces: readonly string[],
): LabelMap {
  const types: Record<string, string> = {};
  for (const { key, trackerLabel } of taxonomy.types) {
    types[key] = trackerLabel;
  }

  const scopes: Record<string, string> = {};
  for (const workspace of workspaces) {
    scopes[workspace] = toScopeLabel(workspace);
  }
  if (workspaces.length > 0) {
    scopes[ROOT_SCOPE] = toScopeLabel(ROOT_SCOPE);
  }

  return { scopes, types };
}

/** The label names that a tracker applies for each work type and each scope. */
export interface LabelMap {
  scopes: Record<string, string>;
  types: Record<string, string>;
}

// region | Helpers

/** Names the tracker label of a scope. */
function toScopeLabel(scope: string): string {
  return `scope:${scope}`;
}

// endregion | Helpers
