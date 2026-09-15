/**
 * Shared helpers for the `work-types:check` and `work-types:sync` maintainer scripts.
 */

import { resolve } from 'node:path';

/**
 * Build the `init` argument for `fetch` to reach codeassembly's canonical work-types files.
 *
 * Returns `{ headers: { Authorization: 'Bearer <token>' } }` when `GITHUB_TOKEN` is set in the
 * environment; returns `undefined` otherwise so the call site stays byte-identical to an
 * unauthenticated request. Centralised here so `checkWorkTypesDrift` and `syncWorkTypes`
 * cannot diverge on auth handling. Tests stub the env via `vi.stubEnv` rather than parameter
 * injection, so this reads `process.env` directly.
 */
export function buildFetchInit(): RequestInit | undefined {
  const token = process.env['GITHUB_TOKEN'];
  if (token === undefined || token === '') {
    return undefined;
  }
  return { headers: { Authorization: `Bearer ${token}` } };
}

/** Sanity-check that the parsed upstream JSON carries the expected top-level shape. */
export function hasExpectedTopLevelShape(value: unknown): value is { tiers: unknown[]; types: unknown[] } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('tiers' in value) || !('types' in value)) {
    return false;
  }
  return Array.isArray(value.tiers) && Array.isArray(value.types);
}

/**
 * Reports whether the parsed local JSON equals the upstream JSON, ignoring the local-only `$schema` IDE hint.
 *
 * The hint is stripped from the local side alone: `$schema` appearing upstream is a real upstream change and counts
 * as a difference.
 */
export function matchesUpstream(localJson: unknown, upstreamJson: unknown): boolean {
  return isDeepEqual(stripLocalOnlyFields(localJson), upstreamJson);
}

/**
 * Absolute path of the package's committed `src/work-types.json`, resolved from this module's location so that it
 * holds from any working directory.
 */
export const WORK_TYPES_JSON_PATH = resolve(import.meta.dirname, '..', 'src', 'work-types.json');

// region | Helpers

/** Reports whether two JSON-compatible values are structurally equal. */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const aRecord: Record<string, unknown> = { ...a };
    const bRecord: Record<string, unknown> = { ...b };
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!isDeepEqual(aRecord[key], bRecord[key])) return false;
    }
    return true;
  }
  return false;
}

/** Returns a shallow copy of the parsed local JSON without the local-only `$schema` IDE hint. */
function stripLocalOnlyFields(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const record: Record<string, unknown> = { ...value };
  delete record['$schema'];
  return record;
}

// endregion | Helpers
