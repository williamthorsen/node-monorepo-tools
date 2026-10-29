import { spawnSync } from 'node:child_process';
import process from 'node:process';

import type { AuditResult } from './types.ts';

/** Resolves the audit-ci binary path from node_modules. */
export function resolveAuditCiBin(): string {
  try {
    const resolvedUrl = import.meta.resolve('audit-ci');
    const modulePath = new URL(resolvedUrl).pathname;
    // audit-ci v7 publishes its CLI at dist/bin.js
    const packageDir = modulePath.replace(/\/dist\/.*$/, '');
    return `${packageDir}/dist/bin.js`;
  } catch {
    return 'audit-ci';
  }
}

interface AuditCiAdvisory {
  cvss?: { score?: number; vectorString?: string };
  findings: Array<{ paths: string[] }>;
  github_advisory_id?: string;
  id: number | string;
  module_name: string;
  overview?: string;
  severity?: string;
  title?: string;
  url: string;
}

/** Result of parsing audit-ci output, including any warnings. */
export interface ParseResult {
  results: AuditResult[];
  warnings: string[];
}

/**
 * Parses audit-ci JSON output into typed audit results.
 *
 * Extracts advisories from the JSON, mapping each to an `AuditResult` with
 * the first discovered dependency path. Returns warnings when input is
 * non-empty but not parseable.
 */
export function parseAuditCiOutput(jsonString: string): ParseResult {
  const warnings: string[] = [];

  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(jsonString);
  } catch {
    if (jsonString.trim().length > 0) {
      warnings.push(`Failed to parse audit-ci output as JSON (${jsonString.length} bytes)`);
    }
    return { results: [], warnings };
  }

  if (typeof parsedOutput !== 'object' || parsedOutput === null) {
    return { results: [], warnings };
  }

  const advisories = extractAdvisories(parsedOutput);
  const results: AuditResult[] = [];
  for (const advisory of advisories) {
    const paths = extractPaths(advisory);
    const firstPath = paths[0] ?? advisory.module_name;
    const result: AuditResult = {
      id: String(advisory.id),
      path: firstPath,
      paths,
      url: advisory.url,
    };
    if (typeof advisory.github_advisory_id === 'string') {
      result.ghsaId = advisory.github_advisory_id;
    }
    if (typeof advisory.severity === 'string') {
      result.severity = advisory.severity;
    }
    if (typeof advisory.title === 'string') {
      result.title = advisory.title;
    }
    if (typeof advisory.overview === 'string') {
      result.description = advisory.overview;
    }
    if (advisory.cvss !== undefined) {
      result.cvss = advisory.cvss;
    }
    results.push(result);
  }

  return { results, warnings };
}

/** Narrows an unknown value to a non-null object. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Checks whether a value has the shape of an AuditCiAdvisory. */
function isAuditCiAdvisory(value: unknown): value is AuditCiAdvisory {
  if (!isObject(value)) return false;
  return 'id' in value && 'url' in value && 'findings' in value;
}

/** Extracts advisories from an object that has an `advisories` record. */
function collectAdvisories(candidate: object): AuditCiAdvisory[] {
  if (!('advisories' in candidate) || typeof candidate.advisories !== 'object' || candidate.advisories === null) {
    return [];
  }
  return Object.values(candidate.advisories).filter(isAuditCiAdvisory);
}

/** Extracts advisory objects from various audit-ci output shapes. */
function extractAdvisories(parsedOutput: unknown): AuditCiAdvisory[] {
  if (typeof parsedOutput !== 'object' || parsedOutput === null) return [];

  // Shape: { advisories: { [id]: advisory } }
  if ('advisories' in parsedOutput) {
    return collectAdvisories(parsedOutput);
  }

  // Shape: array of objects with an advisories field
  if (Array.isArray(parsedOutput)) {
    const advisories: AuditCiAdvisory[] = [];
    for (const item of parsedOutput) {
      if (isObject(item)) {
        advisories.push(...collectAdvisories(item));
      }
    }
    return advisories;
  }

  return [];
}

/** Extracts all dependency paths across an advisory's findings, deduplicated in insertion order. */
function extractPaths(advisory: AuditCiAdvisory): string[] {
  const seenPaths = new Set<string>();
  const orderedPaths: string[] = [];
  for (const finding of advisory.findings) {
    for (const pathValue of finding.paths) {
      if (seenPaths.has(pathValue)) {
        continue;
      }

      seenPaths.add(pathValue);
      orderedPaths.push(pathValue);
    }
  }
  return orderedPaths;
}

/** Result of extracting stale entries, including any warnings. */
export interface StaleEntriesResult {
  entries: string[];
  warnings: string[];
}

/** Extracts stale allowlist entries from audit-ci JSON output. */
export function extractStaleEntries(jsonString: string): StaleEntriesResult {
  const warnings: string[] = [];

  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(jsonString);
  } catch {
    if (jsonString.trim().length > 0) {
      warnings.push(`Failed to parse audit-ci output as JSON for stale entry detection (${jsonString.length} bytes)`);
    }
    return { entries: [], warnings };
  }

  if (typeof parsedOutput !== 'object' || parsedOutput === null) return { entries: [], warnings };
  if (!('allowlistedAdvisoriesNotFound' in parsedOutput)) return { entries: [], warnings };

  const notFoundEntries = parsedOutput.allowlistedAdvisoriesNotFound;
  if (Array.isArray(notFoundEntries)) {
    return { entries: notFoundEntries.filter((item): item is string => typeof item === 'string'), warnings };
  }

  return { entries: [], warnings };
}

/** Options for running audit-ci. */
interface RunAuditOptions {
  configPath: string;
  cwd?: string;
  isJson?: boolean;
  reportType?: 'full';
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
 * Invokes audit-ci with the given config file in normal (CI) mode.
 *
 * Returns the exit code faithfully. When `isJson` is true, output is JSON;
 * otherwise audit-ci uses its default text format. Stale overrides are
 * detected from JSON output and returned.
 */
export function runAudit({ configPath, cwd, isJson }: RunAuditOptions): AuditRunResult {
  const bin = resolveAuditCiBin();
  const outputFormat = isJson ? 'json' : 'text';
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
  const staleResult = isJson ? extractStaleEntries(stdout) : { entries: [], warnings: [] };

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
 * Invokes audit-ci with JSON output and parses the advisories into `AuditResult` objects.
 *
 * Decides on the output rather than the exit code, because audit-ci exits non-zero both when it finds vulnerabilities
 * and when it cannot audit. Throws when stdout does not contain a JSON report.
 */
export function runReport({ configPath, cwd, reportType }: Omit<RunAuditOptions, 'isJson'>): ReportResult {
  const bin = resolveAuditCiBin();
  const args = ['--config', configPath, '--output-format', 'json'];
  if (reportType === 'full') {
    args.push('--report-type', 'full');
  }

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
  if (!containsJsonReport(stdout)) {
    throw new Error(describeMissingReport(result.status, result.signal, stderr));
  }
  const parseResult = parseAuditCiOutput(stdout);

  return { results: parseResult.results, stdout, stderr, warnings: parseResult.warnings };
}

// region | Helpers
/** Checks whether audit-ci's stdout parses as a JSON object or array, the shapes in which it prints a report. */
function containsJsonReport(stdout: string): boolean {
  try {
    return isObject(JSON.parse(stdout));
  } catch {
    return false;
  }
}

/** Describes an audit-ci run that ended without a report, appending audit-ci's stderr when it wrote any. */
function describeMissingReport(status: number | null, signal: NodeJS.Signals | null, stderr: string): string {
  const ending =
    status === null ? `was terminated by ${signal ?? 'an unknown signal'}` : `exited with status ${status}`;
  const message = `audit-ci ${ending} without producing a report`;
  const trimmedStderr = stderr.trim();
  return trimmedStderr.length > 0 ? `${message}:\n${trimmedStderr}` : message;
}
// endregion | Helpers
