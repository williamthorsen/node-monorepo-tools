import { writeFile } from 'node:fs/promises';

import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import type { AllowlistEntry, AuditResult, AuditScope, ScopeConfig, V11yCheckConfig } from './types.ts';

/** Produces a full ISO 8601 UTC datetime string. */
export function formatUtcDatetime(date: Date): string {
  return date.toISOString();
}

/** Formats a Date as a human-friendly UTC string for use in reason messages. */
export function formatFriendlyUtc(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, 19) + ' UTC';
}

/**
 * Serializes an allowlist entry with keys in alphabetical order.
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

/** Builds a serializable representation of a scope config with ordered keys. */
function serializeScopeConfig(scopeConfig: ScopeConfig): Record<string, unknown> {
  return {
    ...(scopeConfig.severityThreshold !== undefined && { severityThreshold: scopeConfig.severityThreshold }),
    allowlist: scopeConfig.allowlist.map(serializeEntry),
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
 * Computes the updated allowlist by diffing audit results against the current entries.
 *
 * New advisories are added with an auto-populated reason. Resolved advisories are removed.
 * Existing entries are kept unchanged.
 */
export function computeSyncDiff(
  currentAllowlist: AllowlistEntry[],
  auditResults: AuditResult[],
  date?: Date,
): { added: AllowlistEntry[]; kept: AllowlistEntry[]; removed: AllowlistEntry[] } {
  const now = date ?? new Date();
  const currentById = new Map(currentAllowlist.map((entry) => [entry.id, entry]));
  const auditById = new Map(auditResults.map((result) => [result.id, result]));

  const addedEntries: AllowlistEntry[] = [];
  const keptEntries: AllowlistEntry[] = [];
  const removedEntries: AllowlistEntry[] = [];

  const nowIso = formatUtcDatetime(now);
  for (const [id, result] of auditById) {
    const existingEntry = currentById.get(id);
    if (existingEntry !== undefined) {
      keptEntries.push(existingEntry);
    } else {
      addedEntries.push({
        addedAt: nowIso,
        id: result.id,
        path: result.path,
        reason: `Added by v11y sync at ${formatFriendlyUtc(now)}`,
        url: result.url,
      });
    }
  }

  for (const [id, entry] of currentById) {
    if (!auditById.has(id)) {
      removedEntries.push(entry);
    }
  }

  return { added: addedEntries, kept: keptEntries, removed: removedEntries };
}

/**
 * Builds the updated config by replacing the allowlist for the given scope with its entries sorted by ID.
 *
 * Returns a new config object; does not mutate the input.
 */
export function buildUpdatedConfig(
  config: V11yCheckConfig,
  scope: AuditScope,
  newAllowlist: AllowlistEntry[],
): V11yCheckConfig {
  const sortedAllowlist = newAllowlist.toSorted((a, b) => a.id.localeCompare(b.id));
  return {
    ...config,
    [scope]: {
      ...config[scope],
      allowlist: sortedAllowlist,
    },
  };
}

/**
 * Serializes the config to JSON with alphabetically ordered allowlist entry keys.
 *
 * Includes `$schema` when present.
 */
export function serializeConfig(config: V11yCheckConfig): string {
  const serializableConfig = {
    ...(config.$schema !== undefined && { $schema: config.$schema }),
    dev: serializeScopeConfig(config.dev),
    prod: serializeScopeConfig(config.prod),
  };

  return JSON.stringify(serializableConfig, null, 2) + '\n';
}

/**
 * Synchronizes the allowlist for a scope by diffing audit results against the current config.
 *
 * Returns the sync diff and the updated config. Writes the updated config to disk.
 */
export async function syncAllowlist(
  config: V11yCheckConfig,
  scope: AuditScope,
  auditResults: AuditResult[],
  configFilePath: string,
  date?: Date,
): Promise<{ syncResult: SyncResult; updatedConfig: V11yCheckConfig }> {
  const {
    added: addedEntries,
    kept: keptEntries,
    removed: removedEntries,
  } = computeSyncDiff(config[scope].allowlist, auditResults, date);
  const updatedConfig = buildUpdatedConfig(config, scope, [...keptEntries, ...addedEntries]);

  try {
    await writeFile(configFilePath, serializeConfig(updatedConfig), 'utf8');
  } catch (error: unknown) {
    throw chainError(`Failed to write config file '${configFilePath}'`, error);
  }

  return {
    syncResult: { added: addedEntries, kept: keptEntries, removed: removedEntries, scope },
    updatedConfig,
  };
}
