import type { PreflightReport, PreflightResult, ReportOptions } from './types.ts';

const ICON_PASSED = '\u2705';
const ICON_FAILED = '\u274C';
const ICON_SKIPPED = '\u26AA';

/** Format a duration in milliseconds for display. */
function formatDuration(ms: number): string {
  return `${Math.round(ms)}ms`;
}

/** Return the status icon for a result. */
function getIcon(status: PreflightResult['status']): string {
  if (status === 'passed') return ICON_PASSED;
  if (status === 'failed') return ICON_FAILED;
  return ICON_SKIPPED;
}

/** Collect inline detail lines (error and/or fix) for a failed result. */
function collectInlineDetails(result: PreflightResult, includeFix: boolean): string[] {
  const details: string[] = [];
  if (result.error !== undefined) {
    details.push(`  Error: ${result.error.message}`);
  }
  if (includeFix && result.fix !== undefined) {
    details.push(`  Fix: ${result.fix}`);
  }
  return details;
}

/**
 * Format a preflight report as a human-readable string for terminal output.
 *
 * In `END` mode (default), errors appear inline but fix messages are collected in a "Fixes" section at the bottom.
 * In `INLINE` mode, error and fix messages appear directly below each failed check.
 */
export function reportPreflight(report: PreflightReport, options?: ReportOptions): string {
  const fixLocation = options?.fixLocation ?? 'END';
  const lines: string[] = [];
  const collectedFixes: string[] = [];

  for (const result of report.results) {
    const icon = getIcon(result.status);
    lines.push(`${icon} ${result.name} (${formatDuration(result.durationMs)})`);

    if (result.status === 'failed') {
      const includeFix = fixLocation === 'INLINE';
      lines.push(...collectInlineDetails(result, includeFix));

      if (!includeFix && result.fix !== undefined) {
        collectedFixes.push(result.fix);
      }
    }
  }

  // Summary
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of report.results) {
    if (r.status === 'passed') passed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
  }
  lines.push('', `${passed} passed, ${failed} failed, ${skipped} skipped (${formatDuration(report.durationMs)})`);

  // Collected fixes section for END mode
  if (fixLocation === 'END' && collectedFixes.length > 0) {
    lines.push('', 'Fixes:', ...collectedFixes.map((fix) => `  ${fix}`));
  }

  return lines.join('\n');
}
