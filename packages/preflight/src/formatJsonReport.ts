import { meetsThreshold } from './runPreflight.ts';
import type {
  JsonCheckEntry,
  JsonChecklistEntry,
  JsonReport,
  PreflightReport,
  PreflightResult,
  Severity,
} from './types.ts';

interface ChecklistEntry {
  name: string;
  report: PreflightReport;
}

/** Options controlling which results appear in JSON output. */
export interface FormatJsonReportOptions {
  reportOn?: Severity;
}

/** Transform an array of checklist results into a JSON-serializable report string. */
export function formatJsonReport(entries: ChecklistEntry[], options?: FormatJsonReportOptions): string {
  const reportOn = options?.reportOn ?? 'recommend';
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  const checklists: JsonChecklistEntry[] = entries.map(({ name, report }) => {
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    // Filter results by reporting threshold.
    const visibleResults = report.results.filter((r) => meetsThreshold(r.severity, reportOn));

    const checks: JsonCheckEntry[] = visibleResults.map((result) => {
      if (result.status === 'passed') passed++;
      else if (result.status === 'failed') failed++;
      else skipped++;

      return buildCheckEntry(result);
    });

    totalPassed += passed;
    totalFailed += failed;
    totalSkipped += skipped;

    return {
      name,
      allPassed: report.passed,
      durationMs: report.durationMs,
      passed,
      failed,
      skipped,
      checks,
    };
  });

  const totalDurationMs = checklists.reduce((sum, c) => sum + c.durationMs, 0);

  const output: JsonReport = {
    allPassed: totalFailed === 0,
    passed: totalPassed,
    failed: totalFailed,
    skipped: totalSkipped,
    durationMs: totalDurationMs,
    checklists,
  };

  return JSON.stringify(output);
}

/**
 * Build a single JSON check entry, normalizing the union to include all fields.
 *
 * Non-skipped results get `skipReason: null` for uniform JSON shape.
 * Error objects are serialized to their message string.
 */
function buildCheckEntry(result: PreflightResult): JsonCheckEntry {
  const errorString = result.error !== null ? result.error.message : null;

  if (result.status === 'skipped') {
    return {
      name: result.name,
      status: result.status,
      ok: result.ok,
      severity: result.severity,
      skipReason: result.skipReason,
      detail: result.detail,
      fix: result.fix,
      error: errorString,
      progress: result.progress,
      durationMs: result.durationMs,
    };
  }

  return {
    name: result.name,
    status: result.status,
    ok: result.ok,
    severity: result.severity,
    skipReason: null,
    detail: result.detail,
    fix: result.fix,
    error: errorString,
    progress: result.progress,
    durationMs: result.durationMs,
  };
}
