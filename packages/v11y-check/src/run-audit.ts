import process from 'node:process';

import { UserError } from '@williamthorsen/nmr-core';
import { z } from 'zod';

import { runAuditCi } from './audit-ci-runner.ts';
import type { AuditResult } from './types.ts';

const auditCiAdvisorySchema = z.object({
  cvss: absentWhenNull(
    z.object({
      score: absentWhenNull(z.number()),
      vectorString: absentWhenNull(z.string()),
    }),
  ),
  findings: z.array(z.object({ paths: z.array(z.string()) })),
  github_advisory_id: absentWhenNull(z.string()),
  id: z.union([z.number(), z.string()]),
  module_name: z.string(),
  overview: absentWhenNull(z.string()),
  severity: absentWhenNull(z.string()),
  title: absentWhenNull(z.string()),
  url: z.string(),
});

type AuditCiAdvisory = z.infer<typeof auditCiAdvisorySchema>;

/** Advisories extracted from audit-ci output, with a warning for each entry that does not parse. */
interface ExtractedAdvisories {
  advisories: AuditCiAdvisory[];
  warnings: string[];
}

/** Result of parsing audit-ci output, including any warnings. */
export interface ParseResult {
  results: AuditResult[];
  warnings: string[];
}

/**
 * Parses audit-ci JSON output into typed audit results.
 *
 * Extracts advisories from the JSON, mapping each to an `AuditResult` whose
 * dependency paths are sorted, so that the result does not depend on the order
 * in which audit-ci reports them. Returns a warning when input is non-empty but
 * not parseable, and one for each advisory that does not match the expected
 * shape, which it skips.
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

  const extracted = extractAdvisories(parsedOutput);
  warnings.push(...extracted.warnings);
  const results: AuditResult[] = [];
  for (const advisory of extracted.advisories) {
    const paths = extractPaths(advisory);
    const firstPath = paths[0] ?? advisory.module_name;
    const result: AuditResult = {
      id: String(advisory.id),
      path: firstPath,
      paths,
      url: advisory.url,
    };
    if (advisory.github_advisory_id !== undefined) {
      result.ghsaId = advisory.github_advisory_id;
    }
    if (advisory.severity !== undefined) {
      result.severity = advisory.severity;
    }
    if (advisory.title !== undefined) {
      result.title = advisory.title;
    }
    if (advisory.overview !== undefined) {
      result.description = advisory.overview;
    }
    if (advisory.cvss !== undefined) {
      result.cvss = buildCvss(advisory.cvss);
    }
    results.push(result);
  }

  return { results, warnings };
}

/** Narrows an unknown value to a non-null object. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Parses each entry of an object's `advisories` record, warning on each entry that does not match the schema. */
function collectAdvisories(candidate: object): ExtractedAdvisories {
  if (!('advisories' in candidate) || !isObject(candidate.advisories)) {
    return { advisories: [], warnings: [] };
  }
  const advisories: AuditCiAdvisory[] = [];
  const warnings: string[] = [];
  for (const [key, entry] of Object.entries(candidate.advisories)) {
    const parsed = auditCiAdvisorySchema.safeParse(entry);
    if (parsed.success) {
      advisories.push(parsed.data);
    } else {
      warnings.push(`Skipped malformed audit-ci advisory ${key}: ${summarizeIssues(parsed.error)}`);
    }
  }
  return { advisories, warnings };
}

/** Extracts advisory objects from various audit-ci output shapes. */
function extractAdvisories(parsedOutput: unknown): ExtractedAdvisories {
  if (typeof parsedOutput !== 'object' || parsedOutput === null) return { advisories: [], warnings: [] };

  // Shape: { advisories: { [id]: advisory } }
  if ('advisories' in parsedOutput) {
    return collectAdvisories(parsedOutput);
  }

  // Shape: array of objects with an advisories field
  if (Array.isArray(parsedOutput)) {
    const advisories: AuditCiAdvisory[] = [];
    const warnings: string[] = [];
    for (const item of parsedOutput) {
      if (!isObject(item)) continue;
      const collected = collectAdvisories(item);
      advisories.push(...collected.advisories);
      warnings.push(...collected.warnings);
    }
    return { advisories, warnings };
  }

  return { advisories: [], warnings: [] };
}

/** Extracts all dependency paths across an advisory's findings, deduplicated and sorted. */
function extractPaths(advisory: AuditCiAdvisory): string[] {
  const uniquePaths = new Set(advisory.findings.flatMap((finding) => finding.paths));
  // Compare by code unit so that the order does not depend on the locale.
  return [...uniquePaths].toSorted();
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
  const outputFormat = isJson ? 'json' : 'text';
  const args = ['--config', configPath, '--output-format', outputFormat];

  const result = runAuditCi(args, cwd ?? process.cwd());

  if (result.error) {
    throw new UserError(`Failed to launch audit-ci: ${result.error.message}`);
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
  const args = ['--config', configPath, '--output-format', 'json'];
  if (reportType === 'full') {
    args.push('--report-type', 'full');
  }

  const result = runAuditCi(args, cwd ?? process.cwd());

  if (result.error) {
    throw new UserError(`Failed to launch audit-ci: ${result.error.message}`);
  }

  const stdout = result.stdout;
  const stderr = result.stderr;
  if (!containsJsonReport(stdout)) {
    throw new UserError(describeMissingReport(result.status, result.signal, stderr));
  }
  const parseResult = parseAuditCiOutput(stdout);

  return { results: parseResult.results, stdout, stderr, warnings: parseResult.warnings };
}

// region | Helpers
/** Makes a field optional and treats a `null` value as absent. */
function absentWhenNull<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((value) => value ?? undefined);
}

/** Copies an advisory's CVSS fields into an `AuditResult` CVSS, omitting the absent ones. */
function buildCvss(cvss: NonNullable<AuditCiAdvisory['cvss']>): NonNullable<AuditResult['cvss']> {
  const result: NonNullable<AuditResult['cvss']> = {};
  if (cvss.score !== undefined) result.score = cvss.score;
  if (cvss.vectorString !== undefined) result.vectorString = cvss.vectorString;
  return result;
}

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

/** Summarizes a schema error's issues on one line, each as its field path and message. */
function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
// endregion | Helpers
