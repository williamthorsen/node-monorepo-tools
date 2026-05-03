import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UPSTREAM_WORK_TYPES_URL } from './checkWorkTypesDrift.ts';
import { isRecord } from './typeGuards.ts';
import { errorMessage, hasExpectedTopLevelShape } from './workTypesUtils.ts';

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

/** Extract the prior `$schema` IDE-hint URL from local file content, or `undefined` if absent or unparseable. */
function extractLocalSchemaUrl(content: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const schema = parsed.$schema;
  return typeof schema === 'string' ? schema : undefined;
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

  let priorContent: string | undefined;
  try {
    priorContent = readFileSync(localPath, 'utf8');
  } catch {
    priorContent = undefined;
  }

  // Preserve the local-only `$schema` IDE hint if the prior file carried one. Upstream never carries
  // `$schema` (the relative path is local-decoration), and `checkWorkTypesDrift` strips it before
  // comparison; sync must symmetrically re-inject it so the synced file remains self-validating in
  // editors. Spread it first so it serialises at the top of the JSON object.
  const localSchemaUrl = priorContent !== undefined ? extractLocalSchemaUrl(priorContent) : undefined;
  const outputJson = localSchemaUrl !== undefined ? { $schema: localSchemaUrl, ...upstreamJson } : upstreamJson;

  // Re-serialise with 2-space indent + trailing newline to match the local format.
  const formatted = `${JSON.stringify(outputJson, null, 2)}\n`;

  if (priorContent === formatted) {
    return {
      exitCode: 0,
      message: `Local work-types.json already matches upstream (${localPath}).`,
    };
  }

  try {
    writeFileSync(localPath, formatted, 'utf8');
  } catch (error) {
    return {
      exitCode: 2,
      message: `Failed to write ${localPath}: ${errorMessage(error)}`,
    };
  }
  return {
    exitCode: 0,
    message: `Synced work-types.json from ${url} → ${localPath}.`,
  };
}
