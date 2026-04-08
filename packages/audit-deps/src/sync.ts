import { writeFile } from 'node:fs/promises';

import type { AllowlistEntry, AuditDepsConfig, AuditResult, AuditScope } from './types.ts';

/** Produce a UTC date string in YYYY-MM-DD format. */
function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Serialize an allowlist entry with keys in alphabetical order.
 *
 * Produces consistent, reviewable JSON diffs regardless of insertion order.
 */
function serializeEntry(entry: AllowlistEntry): Record<string, string | undefined> {
  return {
    id: entry.id,
    path: entry.path,
    reason: entry.reason,
    url: entry.url,
  };
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
  for (const [id, result] of auditById) {
    const existing = currentById.get(id);
    if (existing !== undefined) {
      kept.push(existing);
    } else {
      added.push({
        id: result.id,
        path: result.path,
        reason: `Added by audit-deps sync on ${formatUtcDate(now)}`,
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
 * Uses a custom replacer to guarantee key order within allowlist entries.
 */
export function serializeConfig(config: AuditDepsConfig): string {
  const serializable = {
    ...config,
    dev: {
      ...config.dev,
      allowlist: config.dev.allowlist.map(serializeEntry),
    },
    prod: {
      ...config.prod,
      allowlist: config.prod.allowlist.map(serializeEntry),
    },
  };
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

  await writeFile(configFilePath, serializeConfig(updatedConfig), 'utf8');

  return {
    syncResult: { added, kept, removed, scope },
    updatedConfig,
  };
}
