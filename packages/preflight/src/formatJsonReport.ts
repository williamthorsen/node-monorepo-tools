import type { PreflightReport, PreflightResult, Progress } from './types.ts';
import { isPercentProgress } from './types.ts';

interface ChecklistEntry {
  name: string;
  report: PreflightReport;
}

interface JsonCheckResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  fix?: string;
  error?: string;
  detail?: string;
  progress?: JsonProgress;
}

type JsonProgress = JsonFractionProgress | JsonPercentProgress;

interface JsonFractionProgress {
  type: 'fraction';
  passedCount: number;
  count: number;
}

interface JsonPercentProgress {
  type: 'percent';
  percent: number;
}

interface JsonChecklist {
  name: string;
  allPassed: boolean;
  durationMs: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  checks: JsonCheckResult[];
}

interface JsonReport {
  allPassed: boolean;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  checklists: JsonChecklist[];
}

/** Transform an array of checklist results into a JSON-serializable report object. */
export function formatJsonReport(entries: ChecklistEntry[]): string {
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  const checklists: JsonChecklist[] = entries.map(({ name, report }) => {
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    const checks: JsonCheckResult[] = report.results.map((result) => {
      if (result.status === 'passed') passed++;
      else if (result.status === 'failed') failed++;
      else skipped++;

      return buildCheckResult(result);
    });

    totalPassed += passed;
    totalFailed += failed;
    totalSkipped += skipped;

    return {
      name,
      allPassed: report.passed,
      durationMs: report.durationMs,
      passedCount: passed,
      failedCount: failed,
      skippedCount: skipped,
      checks,
    };
  });

  const totalDurationMs = checklists.reduce((sum, c) => sum + c.durationMs, 0);

  const output: JsonReport = {
    allPassed: totalFailed === 0,
    passedCount: totalPassed,
    failedCount: totalFailed,
    skippedCount: totalSkipped,
    durationMs: totalDurationMs,
    checklists,
  };

  return JSON.stringify(output);
}

/** Build a single check result, omitting undefined optional fields. */
function buildCheckResult(result: PreflightResult): JsonCheckResult {
  const entry: JsonCheckResult = {
    name: result.name,
    status: result.status,
    durationMs: result.durationMs,
  };

  if (result.fix !== undefined) entry.fix = result.fix;
  if (result.error !== undefined) entry.error = result.error.message;
  if (result.detail !== undefined) entry.detail = result.detail;
  if (result.progress !== undefined) entry.progress = serializeProgress(result.progress);

  return entry;
}

/** Serialize a Progress union into a plain object with only the relevant fields. */
function serializeProgress(progress: Progress): JsonProgress {
  if (isPercentProgress(progress)) {
    return { type: 'percent', percent: progress.percent };
  }
  return { type: 'fraction', passedCount: progress.passedCount, count: progress.count };
}
