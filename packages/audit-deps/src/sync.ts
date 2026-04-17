import { writeFile } from 'node:fs/promises';

import type { AllowlistEntry, AuditDepsConfig, AuditResult, AuditScope, ScopeConfig } from './types.ts';

/** Produce a full ISO 8601 UTC datetime string. */
export function formatUtcDatetime(date: Date): string {
  return date.toISOString();
}

/** Format a Date as a human-friendly UTC string for use in reason messages. */
export function formatFriendlyUtc(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, 19) + ' UTC';
}

/**
 * Serialize an allowlist entry with keys in alphabetical order.
 *
 * Produces consistent, reviewable JSON diffs regardless of insertion order.
 */
function serializeEntry(entry: AllowlistEntry): Record<string, string> {
  return {
    ...(entry.addedAt !== undefined && { addedAt: entry.addedAt }),
    id: entry.id,
    path: entry.path,
    ...(entry.reason !== undefined && { reason: entry.reason }),
    url: entry.url,
  };
}

/** Build a serializable representation of a scope config with ordered keys. */
function serializeScopeConfig(scopeConfig: ScopeConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (scopeConfig.severityThreshold !== undefined) {
    result.severityThreshold = scopeConfig.severityThreshold;
  }
  result.allowlist = scopeConfig.allowlist.map(serializeEntry);
  return result;
}

/** Result of a sync operation for a single scope. */
export interface SyncResult {
  added: AllowlistEntry[];
  kept: AllowlistEntry[];
  removed: AllowlistEntry[];
  scope: AuditScope;
}

/**
 * Compute the updated allowlist by diffing audit results against the current entries.
 *
 * New advisories are added with an auto-populated reason. Resolved advisories are removed.
 * Existing entries with a non-empty reason are preserved.
 */
export function computeSyncDiff(
  currentAllowlist: AllowlistEntry[],
  auditResults: AuditResult[],
  date?: Date,
): { added: AllowlistEntry[]; kept: AllowlistEntry[]; removed: AllowlistEntry[] } {
  const now = date ?? new Date();
  const currentById = new Map(currentAllowlist.map((entry) => [entry.id, entry]));
  const auditById = new Map(auditResults.map((result) => [result.id, result]));

  const added: AllowlistEntry[] = [];
  const kept: AllowlistEntry[] = [];
  const removed: AllowlistEntry[] = [];

  // Identify new and kept entries
  const nowIso = formatUtcDatetime(now);
  for (const [id, result] of auditById) {
    const existing = currentById.get(id);
    if (existing !== undefined) {
      kept.push(existing);
    } else {
      added.push({
        addedAt: nowIso,
        id: result.id,
        path: result.path,
        reason: `Added by audit-deps sync at ${formatFriendlyUtc(now)}`,
        url: result.url,
      });
    }
  }

  // Identify removed entries
  for (const [id, entry] of currentById) {
    if (!auditById.has(id)) {
      removed.push(entry);
    }
  }

  return { added, kept, removed };
}

/**
 * Build the updated config by replacing the allowlist for the given scope.
 *
 * Returns a new config object; does not mutate the input.
 */
export function buildUpdatedConfig(
  config: AuditDepsConfig,
  scope: AuditScope,
  newAllowlist: AllowlistEntry[],
): AuditDepsConfig {
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node 20+; engine target is >=18.17.0
  const sorted = [...newAllowlist].sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...config,
    [scope]: {
      ...config[scope],
      allowlist: sorted,
    },
  };
}

/**
 * Serialize the config to JSON with alphabetically ordered allowlist entry keys.
 *
 * Includes `$schema` when present. Uses `severityThreshold` instead of boolean fields.
 */
export function serializeConfig(config: AuditDepsConfig): string {
  const serializable: Record<string, unknown> = {};

  if (config.$schema !== undefined) {
    serializable.$schema = config.$schema;
  }

  serializable.dev = serializeScopeConfig(config.dev);
  serializable.prod = serializeScopeConfig(config.prod);

  return JSON.stringify(serializable, null, 2) + '\n';
}

/**
 * Synchronize the allowlist for a scope by diffing audit results against the current config.
 *
 * Returns the sync diff and the updated config. Writes the updated config to disk.
 */
export async function syncAllowlist(
  config: AuditDepsConfig,
  scope: AuditScope,
  auditResults: AuditResult[],
  configFilePath: string,
  date?: Date,
): Promise<{ syncResult: SyncResult; updatedConfig: AuditDepsConfig }> {
  const { added, kept, removed } = computeSyncDiff(config[scope].allowlist, auditResults, date);
  const updatedConfig = buildUpdatedConfig(config, scope, [...kept, ...added]);

  try {
    await writeFile(configFilePath, serializeConfig(updatedConfig), 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write config file '${configFilePath}': ${message}`);
  }

  return {
    syncResult: { added, kept, removed, scope },
    updatedConfig,
  };
}
