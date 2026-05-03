import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { errorMessage, hasExpectedTopLevelShape } from './workTypesUtils.ts';

/** URL of the upstream canonical `work-types.json` published by codeassembly. */
export const UPSTREAM_WORK_TYPES_URL =
  'https://raw.githubusercontent.com/williamthorsen/codeassembly/main/packages/agents/content/skills/_data/work-types.json';

/** Outcome of a drift check, paired with a human-readable message. */
export interface DriftCheckResult {
  /**
   * Process exit code semantics:
   * - `0` — match (or upstream missing/transitional, with a warning).
   * - `1` — drift detected.
   * - `2` — network error.
   * - `3` — schema mismatch (upstream JSON does not parse or fails the schema invariants).
   */
  exitCode: 0 | 1 | 2 | 3;
  message: string;
}

/** Minimal injection seam so unit tests can substitute a deterministic fetcher. */
export interface CheckWorkTypesDriftDependencies {
  /** Absolute path of the local `work-types.json`. Defaults to the bundled file. */
  localPath?: string;
  /** HTTP fetcher. Defaults to global `fetch` (Node 18+). */
  fetch?: typeof globalThis.fetch;
  /** Override the upstream URL (used by tests; production callers should leave default). */
  upstreamUrl?: string;
}

/** Resolve the path of the locally-bundled `work-types.json` regardless of cwd. */
function resolveDefaultLocalPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, 'work-types.json');
}

/**
 * Compare the bundled `work-types.json` against the upstream codeassembly canonical and
 * report drift.
 *
 * Failure modes:
 * - Network error → exit 2 with a diagnostic.
 * - Upstream 404 → exit 0 with a transitional warning (codeassembly hasn't published the
 *   JSON yet; the check is informational while migration is in flight).
 * - Schema mismatch → exit 3 with a diagnostic.
 * - Drift → exit 1 with a unified-diff-style message.
 * - Match → exit 0.
 */
export async function checkWorkTypesDrift(
  dependencies: CheckWorkTypesDriftDependencies = {},
): Promise<DriftCheckResult> {
  const localPath = dependencies.localPath ?? resolveDefaultLocalPath();
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const url = dependencies.upstreamUrl ?? UPSTREAM_WORK_TYPES_URL;

  const localContent = readFileSync(localPath, 'utf8');
  let localJson: unknown;
  try {
    localJson = JSON.parse(localContent);
  } catch (error) {
    return {
      exitCode: 3,
      message: `Local work-types.json is not valid JSON: ${errorMessage(error)}`,
    };
  }

  let response: Response;
  try {
    response = await fetcher(url);
  } catch (error) {
    return {
      exitCode: 2,
      message: `Network error fetching upstream work-types.json: ${errorMessage(error)}`,
    };
  }

  if (response.status === 404) {
    return {
      exitCode: 0,
      message: `Upstream work-types.json not yet published at ${url}; skipping drift check.`,
    };
  }

  if (!response.ok) {
    return {
      exitCode: 2,
      message: `Failed to fetch upstream work-types.json: HTTP ${response.status} ${response.statusText}`,
    };
  }

  const upstreamText = await response.text();
  let upstreamJson: unknown;
  try {
    upstreamJson = JSON.parse(upstreamText);
  } catch (error) {
    return {
      exitCode: 3,
      message: `Upstream work-types.json is not valid JSON: ${errorMessage(error)}`,
    };
  }

  if (!hasExpectedTopLevelShape(upstreamJson)) {
    return {
      exitCode: 3,
      message: 'Upstream work-types.json does not match the expected schema shape (missing `tiers` or `types`).',
    };
  }

  // Strip the local-only `$schema` IDE hint before comparing. Upstream never carries it; if
  // it ever does, that signals a real upstream addition and should surface as drift, so we
  // intentionally do not strip it from the upstream side.
  const normalisedLocal = stripLocalOnlyFields(localJson);

  if (deepEqual(normalisedLocal, upstreamJson)) {
    return {
      exitCode: 0,
      message: 'Local work-types.json matches upstream.',
    };
  }

  return {
    exitCode: 1,
    message: `Drift detected. Local and upstream work-types.json differ. Run \`nmr work-types:sync\` to update from upstream.\nLocal:    ${localPath}\nUpstream: ${url}`,
  };
}

/**
 * Return a shallow copy of the parsed local JSON with the local-only `$schema` IDE hint
 * removed. The upstream canonical never carries this field, so leaving it in would cause
 * `deepEqual`'s key-count check to always report drift.
 */
function stripLocalOnlyFields(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const record: Record<string, unknown> = { ...value };
  delete record.$schema;
  return record;
}

/** Deep structural equality for JSON-compatible values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
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
      if (!deepEqual(aRecord[key], bRecord[key])) return false;
    }
    return true;
  }
  return false;
}
