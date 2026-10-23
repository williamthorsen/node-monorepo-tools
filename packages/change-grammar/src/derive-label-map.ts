import { ROOT_SCOPE } from './tokens.ts';
import type { CanonicalWorkTypeEntry } from './types.ts';

/**
 * Maps each work type to its tracker label and each workspace to its scope label, in the order given. Adds `root` after
 * the workspace scopes when the repo is a monorepo, whether or not it has any workspaces.
 */
export function deriveLabelMap(
  taxonomy: { types: readonly Pick<CanonicalWorkTypeEntry, 'key' | 'trackerLabel'>[] },
  workspaces: readonly string[],
  options: { isMonorepo: boolean },
): LabelMap {
  const types: Record<string, string> = {};
  for (const { key, trackerLabel } of taxonomy.types) {
    types[key] = trackerLabel;
  }

  const scopes: Record<string, string> = {};
  for (const workspace of workspaces) {
    scopes[workspace] = toScopeLabel(workspace);
  }
  if (options.isMonorepo) {
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
