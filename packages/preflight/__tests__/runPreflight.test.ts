import { describe, expect, it } from 'vitest';

import { runPreflight } from '../src/runPreflight.ts';
import type { PreflightChecklist, PreflightStagedChecklist } from '../src/types.ts';

describe(runPreflight, () => {
  describe('flat checklists', () => {
    it('marks passing checks as passed', async () => {
      const checklist: PreflightChecklist = {
        name: 'basic',
        checks: [{ name: 'always-true', check: () => true }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(report.results).toHaveLength(1);
      expect(report.results[0]?.status).toBe('passed');
      expect(report.results[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('marks failing checks as failed', async () => {
      const checklist: PreflightChecklist = {
        name: 'basic',
        checks: [{ name: 'always-false', check: () => false, fix: 'Do something' }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(false);
      expect(report.results[0]?.status).toBe('failed');
      expect(report.results[0]?.fix).toBe('Do something');
    });

    it('captures errors from throwing checks', async () => {
      const checklist: PreflightChecklist = {
        name: 'throwing',
        checks: [
          {
            name: 'throws',
            check: () => {
              throw new Error('boom');
            },
          },
        ],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(false);
      expect(report.results[0]?.status).toBe('failed');
      expect(report.results[0]?.error?.message).toBe('boom');
    });

    it('wraps non-Error thrown values in an Error', async () => {
      const checklist: PreflightChecklist = {
        name: 'throwing-string',
        checks: [
          {
            name: 'throws-string',
            check: () => {
              // eslint-disable-next-line @typescript-eslint/only-throw-error
              throw 'a plain string';
            },
          },
        ],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(false);
      expect(report.results[0]?.status).toBe('failed');
      expect(report.results[0]?.error).toBeInstanceOf(Error);
      expect(report.results[0]?.error?.message).toBe('a plain string');
    });

    it('handles async check functions', async () => {
      const checklist: PreflightChecklist = {
        name: 'async',
        checks: [{ name: 'async-true', check: () => Promise.resolve(true) }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(report.results[0]?.status).toBe('passed');
    });

    it('runs all checks concurrently', async () => {
      const order: string[] = [];
      const checklist: PreflightChecklist = {
        name: 'concurrent',
        checks: [
          {
            name: 'slow',
            check: async () => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              order.push('slow');
              return true;
            },
          },
          {
            name: 'fast',
            check: () => {
              order.push('fast');
              return true;
            },
          },
        ],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(order).toStrictEqual(['fast', 'slow']);
    });
  });

  describe('preconditions', () => {
    it('skips all checks when a precondition fails', async () => {
      const checklist: PreflightChecklist = {
        name: 'gated',
        preconditions: [{ name: 'pre-fail', check: () => false }],
        checks: [{ name: 'should-skip', check: () => true }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(false);
      expect(report.results).toHaveLength(2);
      expect(report.results[0]?.status).toBe('failed');
      expect(report.results[1]?.status).toBe('skipped');
    });

    it('runs checks when all preconditions pass', async () => {
      const checklist: PreflightChecklist = {
        name: 'gated',
        preconditions: [{ name: 'pre-pass', check: () => true }],
        checks: [{ name: 'runs', check: () => true }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(report.results).toHaveLength(2);
      expect(report.results[0]?.status).toBe('passed');
      expect(report.results[1]?.status).toBe('passed');
    });
  });

  describe('staged checklists', () => {
    it('skips subsequent groups when a group fails', async () => {
      const checklist: PreflightStagedChecklist = {
        name: 'staged',
        groups: [[{ name: 'g1-fail', check: () => false }], [{ name: 'g2-skip', check: () => true }]],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(false);
      expect(report.results).toHaveLength(2);
      expect(report.results[0]?.status).toBe('failed');
      expect(report.results[1]?.status).toBe('skipped');
    });

    it('runs all groups when earlier groups pass', async () => {
      const checklist: PreflightStagedChecklist = {
        name: 'staged',
        groups: [[{ name: 'g1-pass', check: () => true }], [{ name: 'g2-pass', check: () => true }]],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(report.results).toHaveLength(2);
      expect(report.results.every((r) => r.status === 'passed')).toBe(true);
    });

    it('skips all groups when preconditions fail', async () => {
      const checklist: PreflightStagedChecklist = {
        name: 'staged-gated',
        preconditions: [{ name: 'pre-fail', check: () => false }],
        groups: [[{ name: 'g1', check: () => true }], [{ name: 'g2', check: () => true }]],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(false);
      expect(report.results).toHaveLength(3);
      expect(report.results[0]?.status).toBe('failed');
      expect(report.results[1]?.status).toBe('skipped');
      expect(report.results[2]?.status).toBe('skipped');
    });
  });

  describe('structured check outcomes', () => {
    it('carries detail from a passing CheckOutcome', async () => {
      const checklist: PreflightChecklist = {
        name: 'outcome',
        checks: [{ name: 'with-detail', check: () => ({ ok: true, detail: 'all files present' }) }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(report.results[0]?.status).toBe('passed');
      expect(report.results[0]?.detail).toBe('all files present');
    });

    it('carries progress from a failing CheckOutcome', async () => {
      const checklist: PreflightChecklist = {
        name: 'outcome',
        checks: [
          {
            name: 'with-progress',
            check: () => ({ ok: false, progress: { type: 'fraction', passedCount: 7, count: 10 } }),
          },
        ],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(false);
      expect(report.results[0]?.status).toBe('failed');
      expect(report.results[0]?.progress).toStrictEqual({ type: 'fraction', passedCount: 7, count: 10 });
    });

    it('carries both detail and progress', async () => {
      const checklist: PreflightChecklist = {
        name: 'outcome',
        checks: [
          {
            name: 'full-outcome',
            check: () => ({ ok: false, detail: 'missing deps', progress: { type: 'percent', percent: 85 } }),
          },
        ],
      };

      const report = await runPreflight(checklist);

      expect(report.results[0]?.detail).toBe('missing deps');
      expect(report.results[0]?.progress).toStrictEqual({ type: 'percent', percent: 85 });
    });

    it('does not set detail or progress on skipped results', async () => {
      const checklist: PreflightChecklist = {
        name: 'outcome',
        preconditions: [{ name: 'pre-fail', check: () => false }],
        checks: [{ name: 'skipped-check', check: () => ({ ok: true, detail: 'should not appear' }) }],
      };

      const report = await runPreflight(checklist);

      const skipped = report.results.find((r) => r.status === 'skipped');
      expect(skipped?.detail).toBeUndefined();
      expect(skipped?.progress).toBeUndefined();
    });

    it('handles async CheckOutcome', async () => {
      const checklist: PreflightChecklist = {
        name: 'async-outcome',
        checks: [{ name: 'async-detail', check: () => Promise.resolve({ ok: true, detail: 'async info' }) }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(report.results[0]?.detail).toBe('async info');
    });
  });

  it('computes total duration', async () => {
    const checklist: PreflightChecklist = {
      name: 'timing',
      checks: [{ name: 'quick', check: () => true }],
    };

    const report = await runPreflight(checklist);

    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
