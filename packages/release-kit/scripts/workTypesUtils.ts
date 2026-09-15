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
 * Absolute path of the package's committed `src/work-types.json`, resolved from this module's location so that it
 * holds from any working directory.
 */
export const WORK_TYPES_JSON_PATH = resolve(import.meta.dirname, '..', 'src', 'work-types.json');
