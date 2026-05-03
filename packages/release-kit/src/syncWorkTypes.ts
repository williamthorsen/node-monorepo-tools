import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UPSTREAM_WORK_TYPES_URL } from './checkWorkTypesDrift.ts';

/** Outcome of a sync operation. */
export interface SyncResult {
  /**
   * Process exit code semantics:
   * - `0` — sync succeeded (file may be unchanged).
   * - `2` — network error.
   * - `3` — schema mismatch (upstream JSON does not parse or fails the shape check).
   */
  exitCode: 0 | 2 | 3;
  message: string;
}

/** Minimal injection seam so unit tests can substitute a deterministic fetcher. */
export interface SyncWorkTypesDependencies {
  /** Absolute path of the local `work-types.json`. Defaults to the bundled file. */
  localPath?: string;
  /** HTTP fetcher. Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Override the upstream URL (used by tests). */
  upstreamUrl?: string;
}

/** Resolve the path of the locally-bundled `work-types.json` regardless of cwd. */
function resolveDefaultLocalPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, 'work-types.json');
}

/**
 * Fetch the upstream `work-types.json`, validate its top-level shape, and overwrite the
 * locally-bundled copy with the formatted upstream contents.
 *
 * Output is reformatted to match the local file's conventions (2-space indent, trailing
 * newline) so subsequent diffs are content-driven, not whitespace-driven.
 */
export async function syncWorkTypes(dependencies: SyncWorkTypesDependencies = {}): Promise<SyncResult> {
  const localPath = dependencies.localPath ?? resolveDefaultLocalPath();
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const url = dependencies.upstreamUrl ?? UPSTREAM_WORK_TYPES_URL;

  let response: Response;
  try {
    response = await fetcher(url);
  } catch (error) {
    return {
      exitCode: 2,
      message: `Network error fetching upstream work-types.json: ${errorMessage(error)}`,
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

  // Re-serialise with 2-space indent + trailing newline to match the local format.
  const formatted = `${JSON.stringify(upstreamJson, null, 2)}\n`;

  let priorContent: string | undefined;
  try {
    priorContent = readFileSync(localPath, 'utf8');
  } catch {
    priorContent = undefined;
  }

  if (priorContent === formatted) {
    return {
      exitCode: 0,
      message: `Local work-types.json already matches upstream (${localPath}).`,
    };
  }

  writeFileSync(localPath, formatted, 'utf8');
  return {
    exitCode: 0,
    message: `Synced work-types.json from ${url} → ${localPath}.`,
  };
}

/** Sanity-check that the parsed upstream JSON carries the expected top-level shape. */
function hasExpectedTopLevelShape(value: unknown): value is { tiers: unknown[]; types: unknown[] } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('tiers' in value) || !('types' in value)) {
    return false;
  }
  return Array.isArray(value.tiers) && Array.isArray(value.types);
}

/** Render an unknown error value as a string for diagnostics. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
