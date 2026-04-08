import { spawnSync } from 'node:child_process';
import process from 'node:process';

import type { AuditResult } from './types.ts';

/** Resolve the audit-ci binary path from node_modules. */
function resolveAuditCiBin(): string {
  try {
    const resolved = import.meta.resolve('audit-ci');
    // Strip the file:// protocol and navigate to the bin entry
    const modulePath = new URL(resolved).pathname;
    // audit-ci's bin is at the package root's bin/audit-ci.js
    const pkgDir = modulePath.replace(/\/dist\/.*$/, '');
    return `${pkgDir}/lib/audit-ci.js`;
  } catch {
    return 'audit-ci';
  }
}

interface AuditCiAdvisory {
  id: number;
  module_name: string;
  url: string;
  findings: Array<{ paths: string[] }>;
}

/**
 * Parse audit-ci JSON output into typed audit results.
 *
 * Extracts advisories from the JSON, mapping each to an `AuditResult` with
 * the first discovered dependency path.
 */
export function parseAuditCiOutput(jsonString: string): AuditResult[] {
  const results: AuditResult[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return results;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return results;
  }

  // audit-ci outputs an array of action objects; advisories live inside them.
  // Try multiple known output shapes.
  const advisories = extractAdvisories(parsed);
  for (const advisory of advisories) {
    results.push({
      id: String(advisory.id),
      path: extractPath(advisory),
      url: advisory.url ?? `https://github.com/advisories/GHSA-${advisory.id}`,
    });
  }

  return results;
}

/** Extract advisory objects from various audit-ci output shapes. */
function extractAdvisories(parsed: unknown): AuditCiAdvisory[] {
  if (typeof parsed !== 'object' || parsed === null) return [];

  // Shape: { advisories: { [id]: advisory } }
  const record = parsed as Record<string, unknown>;
  if (record['advisories'] !== undefined && typeof record['advisories'] === 'object' && record['advisories'] !== null) {
    return Object.values(record['advisories'] as Record<string, AuditCiAdvisory>);
  }

  // Shape: array of objects with an advisories field
  if (Array.isArray(parsed)) {
    const advisories: AuditCiAdvisory[] = [];
    for (const item of parsed) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if (obj['advisories'] !== undefined && typeof obj['advisories'] === 'object' && obj['advisories'] !== null) {
          advisories.push(...Object.values(obj['advisories'] as Record<string, AuditCiAdvisory>));
        }
      }
    }
    return advisories;
  }

  return [];
}

/** Extract the first dependency path from an advisory's findings. */
function extractPath(advisory: AuditCiAdvisory): string {
  const firstFinding = advisory.findings?.[0];
  const firstPath = firstFinding?.paths?.[0];
  return firstPath ?? advisory.module_name ?? 'unknown';
}

/** Extract stale allowlist entries from audit-ci JSON output. */
export function extractStaleEntries(jsonString: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];

  const record = parsed as Record<string, unknown>;
  const notFound = record['allowlistedAdvisoriesNotFound'];
  if (Array.isArray(notFound)) {
    return notFound.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

/** Options for running audit-ci. */
interface RunAuditOptions {
  configPath: string;
  cwd?: string;
  json?: boolean;
}

/** Result from a normal audit run. */
export interface AuditRunResult {
  exitCode: number;
  staleEntries: string[];
  stdout: string;
  stderr: string;
}

/**
 * Invoke audit-ci with the given config file in normal (CI) mode.
 *
 * Returns the exit code faithfully. When `json` is true, output is JSON;
 * otherwise audit-ci uses its default text format. Stale overrides are
 * detected from JSON output and returned.
 */
export function runAudit({ configPath, cwd, json }: RunAuditOptions): AuditRunResult {
  const bin = resolveAuditCiBin();
  const args = ['--config', configPath, '--output-format', 'json'];

  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const staleEntries = extractStaleEntries(stdout);

  if (json) {
    return { exitCode: result.status ?? 1, staleEntries, stdout, stderr };
  }

  return { exitCode: result.status ?? 1, staleEntries, stdout, stderr };
}

/** Result from a report-mode audit run. */
export interface ReportResult {
  results: AuditResult[];
  stdout: string;
  stderr: string;
}

/**
 * Invoke audit-ci in report mode (no allowlist filtering, swallows exit code).
 *
 * Always returns exit code 0. Parses JSON output into typed `AuditResult` objects.
 */
export function runReport({ configPath, cwd }: Omit<RunAuditOptions, 'json'>): ReportResult {
  const bin = resolveAuditCiBin();
  const args = ['--config', configPath, '--output-format', 'json'];

  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const results = parseAuditCiOutput(stdout);

  return { results, stdout, stderr };
}
