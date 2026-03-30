import { performance } from 'node:perf_hooks';

import type {
  PreflightCheck,
  PreflightCheckList,
  PreflightReport,
  PreflightResult,
  Progress,
  StagedPreflightCheckList,
} from './types.ts';
import { isFlatCheckList } from './types.ts';

/** Optional fields that may appear on a preflight result. */
interface ResultOptions {
  fix?: string;
  error?: Error;
  detail?: string;
  progress?: Progress;
}

/** Build a result object, only including optional fields when defined. */
function buildResult(
  name: string,
  status: PreflightResult['status'],
  durationMs: number,
  options: ResultOptions = {},
): PreflightResult {
  const result: PreflightResult = { name, status, durationMs };
  if (options.fix !== undefined) {
    result.fix = options.fix;
  }
  if (options.error !== undefined) {
    result.error = options.error;
  }
  if (options.detail !== undefined) {
    result.detail = options.detail;
  }
  if (options.progress !== undefined) {
    result.progress = options.progress;
  }
  return result;
}

/** Execute a single check and return its result. */
async function executeCheck(check: PreflightCheck): Promise<PreflightResult> {
  const start = performance.now();
  try {
    const raw = await check.check();
    const durationMs = performance.now() - start;
    if (typeof raw === 'boolean') {
      return buildResult(check.name, raw ? 'passed' : 'failed', durationMs, { fix: check.fix });
    }
    return buildResult(check.name, raw.ok ? 'passed' : 'failed', durationMs, {
      fix: check.fix,
      detail: raw.detail,
      progress: raw.progress,
    });
  } catch (error_: unknown) {
    const durationMs = performance.now() - start;
    const error = error_ instanceof Error ? error_ : new Error(String(error_));
    return buildResult(check.name, 'failed', durationMs, { fix: check.fix, error });
  }
}

/** Mark a check as skipped with zero duration. */
function skipCheck(check: PreflightCheck): PreflightResult {
  return buildResult(check.name, 'skipped', 0, { fix: check.fix });
}

/** Run preconditions concurrently. Return true if all passed. */
async function runPreconditions(preconditions: PreflightCheck[], results: PreflightResult[]): Promise<boolean> {
  if (preconditions.length === 0) return true;

  const preconditionResults = await Promise.all(preconditions.map(executeCheck));
  results.push(...preconditionResults);

  return preconditionResults.every((r) => r.status === 'passed');
}

/** Run a flat checklist: all checks concurrently. */
async function runFlatChecks(
  checklist: PreflightCheckList,
  results: PreflightResult[],
  preconditionsPassed: boolean,
): Promise<void> {
  if (!preconditionsPassed) {
    results.push(...checklist.checks.map(skipCheck));
    return;
  }

  const checkResults = await Promise.all(checklist.checks.map(executeCheck));
  results.push(...checkResults);
}

/** Run a staged checklist: groups sequentially, checks within each group concurrently. */
async function runStagedChecks(
  checklist: StagedPreflightCheckList,
  results: PreflightResult[],
  preconditionsPassed: boolean,
): Promise<void> {
  if (!preconditionsPassed) {
    for (const group of checklist.groups) {
      results.push(...group.map(skipCheck));
    }
    return;
  }

  let shouldSkipRemaining = false;
  for (const group of checklist.groups) {
    if (shouldSkipRemaining) {
      results.push(...group.map(skipCheck));
      continue;
    }

    const groupResults = await Promise.all(group.map(executeCheck));
    results.push(...groupResults);

    if (groupResults.some((r) => r.status === 'failed')) {
      shouldSkipRemaining = true;
    }
  }
}

/**
 * Run all checks in a checklist and produce a report.
 *
 * Preconditions run first. If any fails, all subsequent checks are skipped.
 * Flat checklists run all checks concurrently. Staged checklists run groups
 * sequentially, bailing on later groups when an earlier group has a failure.
 */
export async function runPreflight(checklist: PreflightCheckList | StagedPreflightCheckList): Promise<PreflightReport> {
  const start = performance.now();
  const results: PreflightResult[] = [];

  const preconditionsPassed = await runPreconditions(checklist.preconditions ?? [], results);

  await (isFlatCheckList(checklist)
    ? runFlatChecks(checklist, results, preconditionsPassed)
    : runStagedChecks(checklist, results, preconditionsPassed));

  const durationMs = performance.now() - start;
  const passed = results.every((r) => r.status !== 'failed');

  return { results, passed, durationMs };
}
