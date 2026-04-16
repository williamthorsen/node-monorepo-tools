import { spawnSync } from 'node:child_process';
import process from 'node:process';

import type { AuditResult } from './types.ts';

/** Resolve the audit-ci binary path from node_modules. */
export function resolveAuditCiBin(): string {
  try {
    const resolved = import.meta.resolve('audit-ci');
    // Strip the file:// protocol and navigate to the bin entry
    const modulePath = new URL(resolved).pathname;
    // audit-ci v7 ships its CLI at dist/bin.js
    const pkgDir = modulePath.replace(/\/dist\/.*$/, '');
    return `${pkgDir}/dist/bin.js`;
  } catch {
    return 'audit-ci';
  }
}

interface AuditCiAdvisory {
  id: number | string;
  module_name: string;
  severity?: string;
  url: string;
  findings: Array<{ paths: string[] }>;
}

/** Result of parsing audit-ci output, including any warnings. */
export interface ParseResult {
  results: AuditResult[];
  warnings: string[];
}

/**
 * Parse audit-ci JSON output into typed audit results.
 *
 * Extracts advisories from the JSON, mapping each to an `AuditResult` with
 * the first discovered dependency path. Returns warnings when input is
 * non-empty but not parseable.
 */
export function parseAuditCiOutput(jsonString: string): ParseResult {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    if (jsonString.trim().length > 0) {
      warnings.push(`Failed to parse audit-ci output as JSON (${jsonString.length} bytes)`);
    }
    return { results: [], warnings };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { results: [], warnings };
  }

  // audit-ci outputs an array of action objects; advisories live inside them.
  // Try multiple known output shapes.
  const advisories = extractAdvisories(parsed);
  const results: AuditResult[] = [];
  for (const advisory of advisories) {
    const result: AuditResult = {
      id: String(advisory.id),
      path: extractPath(advisory),
      url: advisory.url,
    };
    if (typeof advisory.severity === 'string') {
      result.severity = advisory.severity;
    }
    results.push(result);
  }

  return { results, warnings };
}

/** Narrow an unknown value to a non-null object. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Check whether a value has the shape of an AuditCiAdvisory. */
function isAuditCiAdvisory(value: unknown): value is AuditCiAdvisory {
  if (!isObject(value)) return false;
  return 'id' in value && 'url' in value && 'findings' in value;
}

/** Extract advisories from an object that has an `advisories` record. */
function collectAdvisories(obj: object): AuditCiAdvisory[] {
  if (!('advisories' in obj) || typeof obj.advisories !== 'object' || obj.advisories === null) {
    return [];
  }
  return Object.values(obj.advisories).filter(isAuditCiAdvisory);
}

/** Extract advisory objects from various audit-ci output shapes. */
function extractAdvisories(parsed: unknown): AuditCiAdvisory[] {
  if (typeof parsed !== 'object' || parsed === null) return [];

  // Shape: { advisories: { [id]: advisory } }
  if ('advisories' in parsed) {
    return collectAdvisories(parsed);
  }

  // Shape: array of objects with an advisories field
  if (Array.isArray(parsed)) {
    const advisories: AuditCiAdvisory[] = [];
    for (const item of parsed) {
      if (isObject(item)) {
        advisories.push(...collectAdvisories(item));
      }
    }
    return advisories;
  }

  return [];
}

/** Extract the first dependency path from an advisory's findings. */
function extractPath(advisory: AuditCiAdvisory): string {
  const firstFinding = advisory.findings[0];
  const firstPath = firstFinding?.paths[0];
  return firstPath ?? advisory.module_name;
}

/** Result of extracting stale entries, including any warnings. */
export interface StaleEntriesResult {
  entries: string[];
  warnings: string[];
}

/** Extract stale allowlist entries from audit-ci JSON output. */
export function extractStaleEntries(jsonString: string): StaleEntriesResult {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    if (jsonString.trim().length > 0) {
      warnings.push(`Failed to parse audit-ci output as JSON for stale entry detection (${jsonString.length} bytes)`);
    }
    return { entries: [], warnings };
  }

  if (typeof parsed !== 'object' || parsed === null) return { entries: [], warnings };
  if (!('allowlistedAdvisoriesNotFound' in parsed)) return { entries: [], warnings };

  const notFound = parsed.allowlistedAdvisoriesNotFound;
  if (Array.isArray(notFound)) {
    return { entries: notFound.filter((item): item is string => typeof item === 'string'), warnings };
  }

  return { entries: [], warnings };
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
  warnings: string[];
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
  const outputFormat = json ? 'json' : 'text';
  const args = ['--config', configPath, '--output-format', outputFormat];

  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`Failed to launch audit-ci: ${result.error.message}`);
  }

  const stdout = result.stdout;
  const stderr = result.stderr;
  const staleResult = json ? extractStaleEntries(stdout) : { entries: [], warnings: [] };

  return {
    exitCode: result.status ?? 1,
    staleEntries: staleResult.entries,
    stdout,
    stderr,
    warnings: staleResult.warnings,
  };
}

/** Result from a report-mode audit run. */
export interface ReportResult {
  results: AuditResult[];
  stdout: string;
  stderr: string;
  warnings: string[];
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

  if (result.error) {
    throw new Error(`Failed to launch audit-ci: ${result.error.message}`);
  }

  const stdout = result.stdout;
  const stderr = result.stderr;
  const parseResult = parseAuditCiOutput(stdout);

  return { results: parseResult.results, stdout, stderr, warnings: parseResult.warnings };
}
