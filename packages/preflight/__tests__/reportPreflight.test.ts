import { describe, expect, it } from 'vitest';

import { formatSummaryCounts, reportPreflight } from '../src/reportPreflight.ts';
import type { FailedResult, PassedResult, PreflightReport, PreflightResult, SkippedResult } from '../src/types.ts';

function makePassedResult(overrides?: Partial<PassedResult>): PassedResult {
  return {
    name: 'check',
    status: 'passed',
    ok: true,
    severity: 'error',
    detail: null,
    fix: null,
    error: null,
    progress: null,
    durationMs: 10,
    ...overrides,
  };
}

function makeFailedResult(overrides?: Partial<FailedResult>): FailedResult {
  return {
    name: 'check',
    status: 'failed',
    ok: false,
    severity: 'error',
    detail: null,
    fix: null,
    error: null,
    progress: null,
    durationMs: 5,
    ...overrides,
  };
}

function makeSkippedResult(overrides?: Partial<SkippedResult>): SkippedResult {
  return {
    name: 'check',
    status: 'skipped',
    ok: null,
    severity: 'error',
    skipReason: 'precondition',
    detail: null,
    fix: null,
    error: null,
    progress: null,
    durationMs: 0,
    ...overrides,
  };
}

function makeReport(overrides?: Partial<PreflightReport> & { results?: PreflightResult[] }): PreflightReport {
  return {
    results: [],
    passed: true,
    durationMs: 100,
    ...overrides,
  };
}

describe(reportPreflight, () => {
  it('shows passed checks with green circle icon', () => {
    const report = makeReport({
      results: [makePassedResult({ name: 'check-a', durationMs: 10 })],
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u{1F7E2} check-a (10ms)');
  });

  it('shows error-failed checks with red circle icon', () => {
    const report = makeReport({
      results: [makeFailedResult({ name: 'check-b', severity: 'error' })],
      passed: false,
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u{1F534} check-b (5ms)');
  });

  it('shows warn-failed checks with orange circle icon', () => {
    const report = makeReport({
      results: [makeFailedResult({ name: 'check-warn', severity: 'warn' })],
      passed: false,
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u{1F7E0} check-warn (5ms)');
  });

  it('shows recommend-failed checks with yellow circle icon', () => {
    const report = makeReport({
      results: [makeFailedResult({ name: 'check-rec', severity: 'recommend' })],
      passed: false,
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u{1F7E1} check-rec (5ms)');
  });

  it('shows n/a-skipped checks with white circle icon', () => {
    const report = makeReport({
      results: [makeSkippedResult({ name: 'check-na', skipReason: 'n/a' })],
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u26AA check-na (0ms)');
  });

  it('shows precondition-skipped checks with no-entry icon', () => {
    const report = makeReport({
      results: [makeSkippedResult({ name: 'check-pre', skipReason: 'precondition' })],
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u26D4 check-pre (0ms)');
  });

  it('renders the summary line', () => {
    const report = makeReport({
      results: [
        makePassedResult({ name: 'a', durationMs: 10 }),
        makeFailedResult({ name: 'b', durationMs: 20 }),
        makeSkippedResult({ name: 'c' }),
      ],
      passed: false,
      durationMs: 142,
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u{1F7E2} 1 passed, \u{1F534} 1 failed, \u26D4 1 skipped (142ms)');
  });

  it('omits zero counts from the summary line', () => {
    const report = makeReport({
      results: [makePassedResult({ name: 'a', durationMs: 10 }), makePassedResult({ name: 'b', durationMs: 15 })],
      durationMs: 25,
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u{1F7E2} 2 passed (25ms)');
    expect(output).not.toContain('failed');
    expect(output).not.toContain('skipped');
  });

  describe('inline mode', () => {
    it('shows error and fix below failed check', () => {
      const report = makeReport({
        results: [
          makeFailedResult({
            name: 'broken',
            error: new Error('Something went wrong'),
            fix: 'Run npm install',
          }),
        ],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'inline' });
      const lines = output.split('\n');

      expect(output).toContain('Error: Something went wrong');
      expect(output).toContain('Fix: Run npm install');

      const checkLineIndex = lines.findIndex((l) => l.includes('broken'));
      const errorLineIndex = lines.findIndex((l) => l.includes('Error: Something went wrong'));
      expect(errorLineIndex).toBe(checkLineIndex + 1);
    });

    it('shows fix without error when error is null', () => {
      const report = makeReport({
        results: [makeFailedResult({ name: 'broken', fix: 'Run npm install' })],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'inline' });

      expect(output).toContain('Fix: Run npm install');
      expect(output).not.toContain('Error:');
    });

    it('shows error without fix when fix is null', () => {
      const report = makeReport({
        results: [makeFailedResult({ name: 'broken', error: new Error('Missing file') })],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'inline' });

      expect(output).toContain('Error: Missing file');
      expect(output).not.toContain('Fix:');
    });
  });

  describe('end mode', () => {
    it('shows error inline and collects fixes at the bottom', () => {
      const report = makeReport({
        results: [
          makeFailedResult({
            name: 'broken',
            error: new Error('Bad config'),
            fix: 'Update config file',
          }),
        ],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'end' });

      const lines = output.split('\n');
      const errorLineIndex = lines.findIndex((l) => l.includes('Error: Bad config'));
      const checkLineIndex = lines.findIndex((l) => l.includes('broken'));
      expect(errorLineIndex).toBe(checkLineIndex + 1);

      expect(output).toContain('Fixes:');
      expect(output).toContain('  Update config file');
    });

    it('omits Fixes section when no fixes are present', () => {
      const report = makeReport({
        results: [makeFailedResult({ name: 'broken', error: new Error('Unknown error') })],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'end' });

      expect(output).toContain('Error: Unknown error');
      expect(output).not.toContain('Fixes:');
    });
  });

  describe('detail and progress rendering', () => {
    it('renders detail inline after duration', () => {
      const report = makeReport({
        results: [makePassedResult({ name: 'check-a', durationMs: 10, detail: 'some info' })],
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F7E2} check-a (10ms) \u2014 some info');
    });

    it('renders fraction progress', () => {
      const report = makeReport({
        results: [
          makeFailedResult({
            name: 'check-b',
            progress: { type: 'fraction', passedCount: 7, count: 10 },
          }),
        ],
        passed: false,
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F534} check-b (5ms) \u2014 7 of 10');
    });

    it('renders percent progress', () => {
      const report = makeReport({
        results: [makeFailedResult({ name: 'check-c', durationMs: 3, progress: { type: 'percent', percent: 85 } })],
        passed: false,
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F534} check-c (3ms) \u2014 85%');
    });

    it('renders both detail and progress as separate segments', () => {
      const report = makeReport({
        results: [
          makeFailedResult({
            name: 'check-d',
            detail: 'some detail',
            progress: { type: 'fraction', passedCount: 7, count: 10 },
          }),
        ],
        passed: false,
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F534} check-d (5ms) \u2014 some detail \u2014 7 of 10');
    });

    it('renders detail and progress on passing checks', () => {
      const report = makeReport({
        results: [
          makePassedResult({
            name: 'check-e',
            durationMs: 2,
            detail: 'all good',
            progress: { type: 'percent', percent: 100 },
          }),
        ],
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F7E2} check-e (2ms) \u2014 all good \u2014 100%');
    });

    it('omits detail segment when detail is null', () => {
      const report = makeReport({
        results: [makePassedResult({ name: 'check-f', durationMs: 1 })],
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F7E2} check-f (1ms)');
      expect(output).not.toContain('\u2014');
    });
  });

  it('defaults to end mode when no options are provided', () => {
    const report = makeReport({
      results: [
        makeFailedResult({
          name: 'broken',
          error: new Error('Oops'),
          fix: 'Fix it',
        }),
      ],
      passed: false,
    });

    const output = reportPreflight(report);

    expect(output).toContain('Fixes:');
    expect(output).toContain('  Fix it');
    expect(output).not.toContain('Fix: Fix it');
  });

  describe('reporting threshold', () => {
    it('excludes results below the reporting threshold', () => {
      const report = makeReport({
        results: [
          makeFailedResult({ name: 'error-check', severity: 'error' }),
          makeFailedResult({ name: 'recommend-check', severity: 'recommend' }),
        ],
        passed: false,
      });

      const output = reportPreflight(report, { reportOn: 'error' });

      expect(output).toContain('error-check');
      expect(output).not.toContain('recommend-check');
    });

    it('counts only visible results in the summary', () => {
      const report = makeReport({
        results: [
          makePassedResult({ name: 'error-pass', severity: 'error' }),
          makePassedResult({ name: 'recommend-pass', severity: 'recommend' }),
        ],
      });

      const output = reportPreflight(report, { reportOn: 'error' });

      expect(output).toContain('\u{1F7E2} 1 passed');
      expect(output).not.toContain('2 passed');
    });

    it('hides precondition result when its severity is below the reporting threshold', () => {
      const report = makeReport({
        results: [
          makeSkippedResult({ name: 'precond', severity: 'recommend', skipReason: 'precondition' }),
          makeFailedResult({ name: 'error-check', severity: 'error' }),
        ],
        passed: false,
      });

      const output = reportPreflight(report, { reportOn: 'error' });

      expect(output).toContain('error-check');
      expect(output).not.toContain('precond');
    });

    it('shows only skipped dependents whose severity meets the reporting threshold', () => {
      const report = makeReport({
        results: [
          makeSkippedResult({ name: 'high-sev-dep', severity: 'error', skipReason: 'precondition' }),
          makeSkippedResult({ name: 'low-sev-dep', severity: 'recommend', skipReason: 'precondition' }),
        ],
      });

      const output = reportPreflight(report, { reportOn: 'warn' });

      expect(output).toContain('high-sev-dep');
      expect(output).not.toContain('low-sev-dep');
    });

    it('defaults reportOn to recommend (show all)', () => {
      const report = makeReport({
        results: [makePassedResult({ name: 'recommend-check', severity: 'recommend' })],
      });

      const output = reportPreflight(report);

      expect(output).toContain('recommend-check');
    });
  });
});

describe(formatSummaryCounts, () => {
  it('includes all non-zero counts with icons', () => {
    expect(formatSummaryCounts(3, 1, 2)).toBe('\u{1F7E2} 3 passed, \u{1F534} 1 failed, \u26D4 2 skipped');
  });

  it('omits zero counts', () => {
    expect(formatSummaryCounts(5, 0, 0)).toBe('\u{1F7E2} 5 passed');
  });

  it('omits passed when zero', () => {
    expect(formatSummaryCounts(0, 2, 1)).toBe('\u{1F534} 2 failed, \u26D4 1 skipped');
  });

  it('returns empty string when all counts are zero', () => {
    expect(formatSummaryCounts(0, 0, 0)).toBe('');
  });
});
