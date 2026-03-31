import { describe, expect, it } from 'vitest';

import { formatSummaryCounts, reportPreflight } from '../src/reportPreflight.ts';
import type { PreflightReport } from '../src/types.ts';

function makeReport(overrides?: Partial<PreflightReport>): PreflightReport {
  return {
    results: [],
    passed: true,
    durationMs: 100,
    ...overrides,
  };
}

describe(reportPreflight, () => {
  it('shows passed checks with checkmark icon', () => {
    const report = makeReport({
      results: [{ name: 'check-a', status: 'passed', durationMs: 10 }],
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u{1F7E2} check-a (10ms)');
  });

  it('shows failed checks with cross icon', () => {
    const report = makeReport({
      results: [{ name: 'check-b', status: 'failed', durationMs: 5 }],
      passed: false,
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u{1F534} check-b (5ms)');
  });

  it('shows skipped checks with circle icon', () => {
    const report = makeReport({
      results: [{ name: 'check-c', status: 'skipped', durationMs: 0 }],
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u26D4 check-c (0ms)');
  });

  it('renders the summary line', () => {
    const report = makeReport({
      results: [
        { name: 'a', status: 'passed', durationMs: 10 },
        { name: 'b', status: 'failed', durationMs: 20 },
        { name: 'c', status: 'skipped', durationMs: 0 },
      ],
      passed: false,
      durationMs: 142,
    });

    const output = reportPreflight(report);

    expect(output).toContain('🟢 1 passed, 🔴 1 failed, ⛔ 1 skipped (142ms)');
  });

  it('omits zero counts from the summary line', () => {
    const report = makeReport({
      results: [
        { name: 'a', status: 'passed', durationMs: 10 },
        { name: 'b', status: 'passed', durationMs: 15 },
      ],
      durationMs: 25,
    });

    const output = reportPreflight(report);

    expect(output).toContain('🟢 2 passed (25ms)');
    expect(output).not.toContain('failed');
    expect(output).not.toContain('skipped');
  });

  describe('INLINE mode', () => {
    it('shows error and fix below failed check', () => {
      const report = makeReport({
        results: [
          {
            name: 'broken',
            status: 'failed',
            error: new Error('Something went wrong'),
            fix: 'Run npm install',
            durationMs: 5,
          },
        ],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'INLINE' });
      const lines = output.split('\n');

      expect(output).toContain('Error: Something went wrong');
      expect(output).toContain('Fix: Run npm install');

      // Error line must immediately follow the check line (no blank line)
      const checkLineIndex = lines.findIndex((l) => l.includes('broken'));
      const errorLineIndex = lines.findIndex((l) => l.includes('Error: Something went wrong'));
      expect(errorLineIndex).toBe(checkLineIndex + 1);
    });

    it('shows fix without error when error is absent', () => {
      const report = makeReport({
        results: [
          {
            name: 'broken',
            status: 'failed',
            fix: 'Run npm install',
            durationMs: 5,
          },
        ],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'INLINE' });

      expect(output).toContain('Fix: Run npm install');
      expect(output).not.toContain('Error:');
    });

    it('shows error without fix when fix is absent', () => {
      const report = makeReport({
        results: [
          {
            name: 'broken',
            status: 'failed',
            error: new Error('Missing file'),
            durationMs: 5,
          },
        ],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'INLINE' });

      expect(output).toContain('Error: Missing file');
      expect(output).not.toContain('Fix:');
    });
  });

  describe('END mode', () => {
    it('shows error inline and collects fixes at the bottom', () => {
      const report = makeReport({
        results: [
          {
            name: 'broken',
            status: 'failed',
            error: new Error('Bad config'),
            fix: 'Update config file',
            durationMs: 5,
          },
        ],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'END' });

      // Error should appear right after the check line
      const lines = output.split('\n');
      const errorLineIndex = lines.findIndex((l) => l.includes('Error: Bad config'));
      const checkLineIndex = lines.findIndex((l) => l.includes('broken'));
      expect(errorLineIndex).toBe(checkLineIndex + 1);

      // Fix should appear in a Fixes section at the bottom
      expect(output).toContain('Fixes:');
      expect(output).toContain('  Update config file');
    });

    it('omits Fixes section when no fixes are present', () => {
      const report = makeReport({
        results: [
          {
            name: 'broken',
            status: 'failed',
            error: new Error('Unknown error'),
            durationMs: 5,
          },
        ],
        passed: false,
      });

      const output = reportPreflight(report, { fixLocation: 'END' });

      expect(output).toContain('Error: Unknown error');
      expect(output).not.toContain('Fixes:');
    });
  });

  describe('detail and progress rendering', () => {
    it('renders detail inline after duration', () => {
      const report = makeReport({
        results: [{ name: 'check-a', status: 'passed', durationMs: 10, detail: 'some info' }],
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F7E2} check-a (10ms) \u2014 some info');
    });

    it('renders fraction progress', () => {
      const report = makeReport({
        results: [
          {
            name: 'check-b',
            status: 'failed',
            durationMs: 5,
            progress: { type: 'fraction', passedCount: 7, count: 10 },
          },
        ],
        passed: false,
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F534} check-b (5ms) \u2014 7 of 10');
    });

    it('renders percent progress', () => {
      const report = makeReport({
        results: [{ name: 'check-c', status: 'failed', durationMs: 3, progress: { type: 'percent', percent: 85 } }],
        passed: false,
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F534} check-c (3ms) \u2014 85%');
    });

    it('renders both detail and progress as separate segments', () => {
      const report = makeReport({
        results: [
          {
            name: 'check-d',
            status: 'failed',
            durationMs: 5,
            detail: 'some detail',
            progress: { type: 'fraction', passedCount: 7, count: 10 },
          },
        ],
        passed: false,
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F534} check-d (5ms) \u2014 some detail \u2014 7 of 10');
    });

    it('renders detail and progress on passing checks', () => {
      const report = makeReport({
        results: [
          {
            name: 'check-e',
            status: 'passed',
            durationMs: 2,
            detail: 'all good',
            progress: { type: 'percent', percent: 100 },
          },
        ],
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F7E2} check-e (2ms) \u2014 all good \u2014 100%');
    });

    it('omits detail segment when detail is undefined', () => {
      const report = makeReport({
        results: [{ name: 'check-f', status: 'passed', durationMs: 1 }],
      });

      const output = reportPreflight(report);

      expect(output).toContain('\u{1F7E2} check-f (1ms)');
      expect(output).not.toContain('\u2014');
    });
  });

  it('defaults to END mode when no options are provided', () => {
    const report = makeReport({
      results: [
        {
          name: 'broken',
          status: 'failed',
          error: new Error('Oops'),
          fix: 'Fix it',
          durationMs: 5,
        },
      ],
      passed: false,
    });

    const output = reportPreflight(report);

    expect(output).toContain('Fixes:');
    expect(output).toContain('  Fix it');
    expect(output).not.toContain('Fix: Fix it');
  });
});

describe(formatSummaryCounts, () => {
  it('includes all non-zero counts with icons', () => {
    expect(formatSummaryCounts(3, 1, 2)).toBe('🟢 3 passed, 🔴 1 failed, ⛔ 2 skipped');
  });

  it('omits zero counts', () => {
    expect(formatSummaryCounts(5, 0, 0)).toBe('🟢 5 passed');
  });

  it('omits passed when zero', () => {
    expect(formatSummaryCounts(0, 2, 1)).toBe('🔴 2 failed, ⛔ 1 skipped');
  });

  it('returns empty string when all counts are zero', () => {
    expect(formatSummaryCounts(0, 0, 0)).toBe('');
  });
});
