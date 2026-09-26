import { SCOPE_WILDCARD } from './tokens.ts';
import type { ChangeRecord } from './types.ts';

/**
 * Applies overrides to a record, each field on its own: A scope of `*` clears the scope, a type replaces the type and
 * keeps the marker, and `breaking` sets the marker in the direction that it names. Every field not named by the
 * overrides, and every field outside the scope, type, and marker, keeps the record's value.
 */
export function applyOverrides(record: ChangeRecord, overrides: Overrides): ChangeRecord {
  const { breaking: _breaking, scope: _scope, type: _type, ...rest } = record;
  const scope = overrides.scope === undefined ? record.scope : readScopeOverride(overrides.scope);
  const type = overrides.type ?? record.type;
  const breaking = overrides.breaking ?? record.breaking === true;
  return {
    ...rest,
    ...(breaking && { breaking }),
    ...(scope !== undefined && { scope }),
    ...(type !== undefined && { type }),
  };
}

/**
 * The scope, type, and breaking marker that an author sets by hand. A reader that can only add the marker supplies
 * `breaking` as `true` or not at all.
 */
export interface Overrides {
  breaking?: boolean;
  scope?: string;
  type?: string;
}

// region | Helpers

/** Reads a scope override, where `*` names no scope. */
function readScopeOverride(scope: string): string | undefined {
  return scope === SCOPE_WILDCARD ? undefined : scope;
}

// endregion | Helpers
