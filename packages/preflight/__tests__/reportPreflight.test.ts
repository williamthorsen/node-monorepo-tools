import { describe, expect, it } from 'vitest';

import { reportPreflight } from '../src/reportPreflight.ts';
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

    expect(output).toContain('\u2705 check-a (10ms)');
  });

  it('shows failed checks with cross icon', () => {
    const report = makeReport({
      results: [{ name: 'check-b', status: 'failed', durationMs: 5 }],
      passed: false,
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u274C check-b (5ms)');
  });

  it('shows skipped checks with circle icon', () => {
    const report = makeReport({
      results: [{ name: 'check-c', status: 'skipped', durationMs: 0 }],
    });

    const output = reportPreflight(report);

    expect(output).toContain('\u26AA check-c (0ms)');
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

    expect(output).toContain('1 passed, 1 failed, 1 skipped (142ms)');
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
