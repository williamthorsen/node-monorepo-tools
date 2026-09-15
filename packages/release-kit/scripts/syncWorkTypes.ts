import { readFileSync, writeFileSync } from 'node:fs';

import { formatErrorLine } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { isRecord } from '../src/typeGuards.ts';
import { UPSTREAM_WORK_TYPES_URL } from './checkWorkTypesDrift.ts';
import { buildFetchInit, hasExpectedTopLevelShape, matchesUpstream } from './workTypesUtils.ts';

/** Outcome of a sync operation. */
export interface SyncResult {
  /**
   * Process exit code semantics:
   * - `0` — sync succeeded (file may be unchanged).
   * - `2` — network error or local write failure.
   * - `3` — schema mismatch (upstream JSON does not parse or fails the shape check).
   */
  exitCode: 0 | 2 | 3;
  message: string;
}

/** Minimal injection seam so unit tests can substitute a deterministic fetcher. */
export interface SyncWorkTypesDependencies {
  /** HTTP fetcher. Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Override the upstream URL (used by tests). */
  upstreamUrl?: string;
}

/**
 * Fetches the upstream `work-types.json`, validates its top-level shape, and overwrites the
 * file at `localPath` with the upstream contents unless that file already matches upstream.
 *
 * The written file keeps the local `$schema` IDE hint, a 2-space indent, and a trailing newline.
 */
export async function syncWorkTypes(
  localPath: string,
  dependencies: SyncWorkTypesDependencies = {},
): Promise<SyncResult> {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const url = dependencies.upstreamUrl ?? UPSTREAM_WORK_TYPES_URL;

  const fetchInit = buildFetchInit();
  let response: Response;
  try {
    response = fetchInit === undefined ? await fetcher(url) : await fetcher(url, fetchInit);
  } catch (error) {
    return {
      exitCode: 2,
      message: formatErrorLine(`Failed to fetch upstream work-types.json: ${describeError(error)}`),
    };
  }

  if (!response.ok) {
    return {
      exitCode: 2,
      message: formatErrorLine(
        `Failed to fetch upstream work-types.json: HTTP ${response.status} ${response.statusText}`,
      ),
    };
  }

  const upstreamText = await response.text();
  let upstreamJson: unknown;
  try {
    upstreamJson = JSON.parse(upstreamText);
  } catch (error) {
    return {
      exitCode: 3,
      message: `Upstream work-types.json is not valid JSON: ${describeError(error)}`,
    };
  }

  if (!hasExpectedTopLevelShape(upstreamJson)) {
    return {
      exitCode: 3,
      message: 'Upstream work-types.json does not match the expected schema shape (missing `tiers` or `types`).',
    };
  }

  const localJson = readLocalJson(localPath);

  if (localJson !== undefined && matchesUpstream(localJson, upstreamJson)) {
    return {
      exitCode: 0,
      message: `Local work-types.json already matches upstream (${localPath}).`,
    };
  }

  // Preserve the local-only `$schema` IDE hint if the prior file carried one. Upstream never carries
  // `$schema` (the relative path is local-decoration), and `matchesUpstream` strips it before
  // comparison; sync must symmetrically re-inject it so the synced file remains self-validating in
  // editors. Spread it first so it serialises at the top of the JSON object.
  const localSchemaUrl = extractLocalSchemaUrl(localJson);
  const outputJson = localSchemaUrl !== undefined ? { $schema: localSchemaUrl, ...upstreamJson } : upstreamJson;
  const formatted = `${JSON.stringify(outputJson, null, 2)}\n`;

  try {
    writeFileSync(localPath, formatted, 'utf8');
  } catch (error) {
    return {
      exitCode: 2,
      message: formatErrorLine(`Failed to write ${localPath}: ${describeError(error)}`),
    };
  }
  return {
    exitCode: 0,
    message: `Synced work-types.json from ${url} → ${localPath}. Update src/workTypesData.ts to match.`,
  };
}

// region | Helpers

/** Returns the `$schema` IDE-hint URL from the parsed local file, or `undefined` if it has none. */
function extractLocalSchemaUrl(localJson: unknown): string | undefined {
  if (!isRecord(localJson)) {
    return undefined;
  }
  const schema = localJson['$schema'];
  return typeof schema === 'string' ? schema : undefined;
}

/** Reads and parses the file at `localPath`, returning `undefined` when it is missing or not valid JSON. */
function readLocalJson(localPath: string): unknown {
  let content: string;
  try {
    content = readFileSync(localPath, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

// endregion | Helpers
