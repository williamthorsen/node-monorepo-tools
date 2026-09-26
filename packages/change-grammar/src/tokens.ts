import type { ChangeRecord } from './types.ts';

/**
 * Sets `root` aside when `scopes` also names a workspace, since `root` holds the files that support a workspace rather
 * than a peer of it. A set naming `root` alone keeps it.
 */
export function dropIncidentalRoot(scopes: Iterable<string>): string[] {
  const named = [...scopes];
  return named.some((scope) => scope !== ROOT_SCOPE) ? named.filter((scope) => scope !== ROOT_SCOPE) : named;
}

/** Reports whether `name` is one of the declared tokens. */
export function isTokenName(name: string): name is TokenName {
  return DECLARED_TOKENS.has(name);
}

/**
 * Brings a record to the form that the rest of the engine assumes: string values trimmed, the `*` scope and every
 * empty value dropped, and a type spelled with the breaking marker split into its bare key and the flag. Idempotent, so
 * a caller may normalize at its own boundary and still pass the result to `render`.
 *
 * The scope is a list, so `splitScopes` reduces it and the surviving names rejoin under the separator.
 */
export function normalizeChangeRecord(record: ChangeRecord): ChangeRecord {
  const normalized: ChangeRecord = {};

  const scope = splitScopes(record.scope).join(SCOPE_SEPARATOR);
  if (scope !== '') {
    normalized.scope = scope;
  }

  const type = record.type?.trim();
  let breaking = record.breaking === true;
  if (type !== undefined && type !== '') {
    if (type.endsWith(BREAKING_MARKER)) {
      normalized.type = type.slice(0, -BREAKING_MARKER.length);
      breaking = true;
    } else {
      normalized.type = type;
    }
  }
  if (breaking) {
    normalized.breaking = true;
  }

  for (const field of ['prNumber', 'ticketRef', 'title'] as const) {
    const value = record[field]?.trim();
    if (value !== undefined && value !== '') {
      normalized[field] = value;
    }
  }

  return normalized;
}

/**
 * Splits a scope value into the workspaces that it names, in first-occurrence order, dropping the empty names, the
 * wildcard, and the duplicates. A value that leaves nothing behind names no scope, which is how a whole-value `*`
 * normalizes away and how `agents,*` reads as `agents`.
 */
export function splitScopes(scope: string | undefined): string[] {
  if (scope === undefined) {
    return [];
  }
  const named = scope
    .split(SCOPE_SEPARATOR)
    .map((element) => element.trim())
    .filter((element) => element !== '' && element !== SCOPE_WILDCARD);
  return [...new Set(named)];
}

/** The marker of a breaking change, whether as its own token or as the tail of a rendered type. */
export const BREAKING_MARKER = '!';

/** The scope of the files that belong to no workspace. */
export const ROOT_SCOPE = 'root';

/** The character that joins the workspaces of a scope naming more than one. */
export const SCOPE_SEPARATOR = ',';

/** The scope standing for a change that spans every workspace. It normalizes to empty and never appears in output. */
export const SCOPE_WILDCARD = '*';

/** The token names that a template may reference; any other `{...}` run is literal text. */
export const TOKEN_NAMES = ['breaking', 'pr_number', 'scope', 'ticket_ref', 'title', 'type'] as const;

/** A token name that a template may reference. */
export type TokenName = (typeof TOKEN_NAMES)[number];

// region | Helpers

/** The declared names, indexed for membership tests. */
const DECLARED_TOKENS: ReadonlySet<string> = new Set(TOKEN_NAMES);

// endregion | Helpers
