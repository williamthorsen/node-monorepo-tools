import { describe, expect, it } from 'vitest';

import { runPreflight } from '../src/runPreflight.ts';
import type { PreflightCheckList, StagedPreflightCheckList } from '../src/types.ts';

describe(runPreflight, () => {
  describe('flat checklists', () => {
    it('marks passing checks as passed', async () => {
      const checklist: PreflightCheckList = {
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
      const checklist: PreflightCheckList = {
        name: 'basic',
        checks: [{ name: 'always-false', check: () => false, fix: 'Do something' }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(false);
      expect(report.results[0]?.status).toBe('failed');
      expect(report.results[0]?.fix).toBe('Do something');
    });

    it('captures errors from throwing checks', async () => {
      const checklist: PreflightCheckList = {
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

    it('handles async check functions', async () => {
      const checklist: PreflightCheckList = {
        name: 'async',
        checks: [{ name: 'async-true', check: () => Promise.resolve(true) }],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(report.results[0]?.status).toBe('passed');
    });

    it('runs all checks concurrently', async () => {
      const order: string[] = [];
      const checklist: PreflightCheckList = {
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
      const checklist: PreflightCheckList = {
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
      const checklist: PreflightCheckList = {
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
      const checklist: StagedPreflightCheckList = {
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
      const checklist: StagedPreflightCheckList = {
        name: 'staged',
        groups: [[{ name: 'g1-pass', check: () => true }], [{ name: 'g2-pass', check: () => true }]],
      };

      const report = await runPreflight(checklist);

      expect(report.passed).toBe(true);
      expect(report.results).toHaveLength(2);
      expect(report.results.every((r) => r.status === 'passed')).toBe(true);
    });

    it('skips all groups when preconditions fail', async () => {
      const checklist: StagedPreflightCheckList = {
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

  it('computes total duration', async () => {
    const checklist: PreflightCheckList = {
      name: 'timing',
      checks: [{ name: 'quick', check: () => true }],
    };

    const report = await runPreflight(checklist);

    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
