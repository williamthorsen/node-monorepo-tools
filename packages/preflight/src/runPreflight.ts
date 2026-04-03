import { performance } from 'node:perf_hooks';

import type {
  FailedResult,
  PassedResult,
  PreflightCheck,
  PreflightChecklist,
  PreflightReport,
  PreflightResult,
  PreflightStagedChecklist,
  Severity,
  SkippedResult,
} from './types.ts';
import { isFlatChecklist } from './types.ts';

/** Options controlling failure and severity defaults for a run. */
export interface RunPreflightOptions {
  defaultSeverity?: Severity;
  failOn?: Severity;
  reportOn?: Severity;
}

/**
 * Numeric rank for severity comparison. Lower rank = higher severity.
 *
 * A result "meets or exceeds" a threshold when its rank is <= the threshold's rank.
 */
const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warn: 1,
  recommend: 2,
};

/** Return true if `severity` is at or above (more severe than or equal to) `threshold`. */
export function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] <= SEVERITY_RANK[threshold];
}

/** Resolve the effective severity for a check. */
function resolveSeverity(check: PreflightCheck, defaultSeverity: Severity): Severity {
  return check.severity ?? defaultSeverity;
}

/** Build a passed result. */
function buildPassedResult(
  name: string,
  severity: Severity,
  durationMs: number,
  detail: string | null,
  fix: string | null,
  progress: import('./types.ts').Progress | null,
): PassedResult {
  return { name, status: 'passed', ok: true, severity, detail, fix, error: null, progress, durationMs };
}

/** Build a failed result. */
function buildFailedResult(
  name: string,
  severity: Severity,
  durationMs: number,
  detail: string | null,
  fix: string | null,
  error: Error | null,
  progress: import('./types.ts').Progress | null,
): FailedResult {
  return { name, status: 'failed', ok: false, severity, detail, fix, error, progress, durationMs };
}

/** Build a skipped result. */
function buildSkippedResult(
  name: string,
  severity: Severity,
  skipReason: 'n/a' | 'precondition',
  detail: string | null,
  fix: string | null,
): SkippedResult {
  return {
    name,
    status: 'skipped',
    ok: null,
    severity,
    skipReason,
    detail,
    fix,
    error: null,
    progress: null,
    durationMs: 0,
  };
}

/** Execute a single check and return its result. */
async function executeCheck(check: PreflightCheck, defaultSeverity: Severity): Promise<PreflightResult> {
  const severity = resolveSeverity(check, defaultSeverity);
  const fix = check.fix ?? null;

  // Evaluate skip condition before running the check.
  if (check.skip !== undefined) {
    const start = performance.now();
    try {
      const skipResult = await check.skip();
      if (typeof skipResult === 'string') {
        return buildSkippedResult(check.name, severity, 'n/a', skipResult, fix);
      }
    } catch (error_: unknown) {
      const durationMs = performance.now() - start;
      const error = error_ instanceof Error ? error_ : new Error(String(error_));
      return buildFailedResult(check.name, severity, durationMs, null, fix, error, null);
    }
  }

  const start = performance.now();
  try {
    const raw = await check.check();
    const durationMs = performance.now() - start;
    if (typeof raw === 'boolean') {
      if (raw) {
        return buildPassedResult(check.name, severity, durationMs, null, fix, null);
      }
      return buildFailedResult(check.name, severity, durationMs, null, fix, null, null);
    }
    const detail = raw.detail ?? null;
    const progress = raw.progress ?? null;
    if (raw.ok) {
      return buildPassedResult(check.name, severity, durationMs, detail, fix, progress);
    }
    return buildFailedResult(check.name, severity, durationMs, detail, fix, null, progress);
  } catch (error_: unknown) {
    const durationMs = performance.now() - start;
    const error = error_ instanceof Error ? error_ : new Error(String(error_));
    return buildFailedResult(check.name, severity, durationMs, null, fix, error, null);
  }
}

/** Mark a check as skipped due to a failed precondition. */
function skipCheck(check: PreflightCheck, defaultSeverity: Severity): PreflightResult {
  const severity = resolveSeverity(check, defaultSeverity);
  return buildSkippedResult(check.name, severity, 'precondition', null, check.fix ?? null);
}

/** Run preconditions concurrently. Return true if all passed. */
async function runPreconditions(
  preconditions: PreflightCheck[],
  results: PreflightResult[],
  defaultSeverity: Severity,
): Promise<boolean> {
  if (preconditions.length === 0) return true;

  const preconditionResults = await Promise.all(preconditions.map((c) => executeCheck(c, defaultSeverity)));
  results.push(...preconditionResults);

  return preconditionResults.every((r) => r.status === 'passed');
}

/** Run a flat checklist: all checks concurrently. */
async function runFlatChecks(
  checklist: PreflightChecklist,
  results: PreflightResult[],
  preconditionsPassed: boolean,
  defaultSeverity: Severity,
): Promise<void> {
  if (!preconditionsPassed) {
    results.push(...checklist.checks.map((c) => skipCheck(c, defaultSeverity)));
    return;
  }

  const checkResults = await Promise.all(checklist.checks.map((c) => executeCheck(c, defaultSeverity)));
  results.push(...checkResults);
}

/** Run a staged checklist: groups sequentially, checks within each group concurrently. */
async function runStagedChecks(
  checklist: PreflightStagedChecklist,
  results: PreflightResult[],
  preconditionsPassed: boolean,
  defaultSeverity: Severity,
  failOn: Severity,
): Promise<void> {
  if (!preconditionsPassed) {
    for (const group of checklist.groups) {
      results.push(...group.map((c) => skipCheck(c, defaultSeverity)));
    }
    return;
  }

  let shouldSkipRemaining = false;
  for (const group of checklist.groups) {
    if (shouldSkipRemaining) {
      results.push(...group.map((c) => skipCheck(c, defaultSeverity)));
      continue;
    }

    const groupResults = await Promise.all(group.map((c) => executeCheck(c, defaultSeverity)));
    results.push(...groupResults);

    // Halt subsequent groups only when a failure meets the failure threshold.
    if (groupResults.some((r) => r.status === 'failed' && meetsThreshold(r.severity, failOn))) {
      shouldSkipRemaining = true;
    }
  }
}

/**
 * Run all checks in a checklist and produce a report.
 *
 * Preconditions run first. If any fails, all subsequent checks are skipped.
 * Flat checklists run all checks concurrently. Staged checklists run groups
 * sequentially, bailing on later groups when an earlier group has a failure
 * at or above the failure threshold.
 */
export async function runPreflight(
  checklist: PreflightChecklist | PreflightStagedChecklist,
  options: RunPreflightOptions = {},
): Promise<PreflightReport> {
  const defaultSeverity = options.defaultSeverity ?? 'error';
  const failOn = options.failOn ?? 'error';
  const start = performance.now();
  const results: PreflightResult[] = [];

  const preconditionsPassed = await runPreconditions(checklist.preconditions ?? [], results, defaultSeverity);

  await (isFlatChecklist(checklist)
    ? runFlatChecks(checklist, results, preconditionsPassed, defaultSeverity)
    : runStagedChecks(checklist, results, preconditionsPassed, defaultSeverity, failOn));

  const durationMs = performance.now() - start;

  // The run passes when no failed result has severity at or above the failure threshold.
  const passed = !results.some((r) => r.status === 'failed' && meetsThreshold(r.severity, failOn));

  return { results, passed, durationMs };
}
