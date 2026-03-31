import { describe, expect, it } from 'vitest';

import { formatJsonReport } from '../src/formatJsonReport.ts';
import type { PreflightReport } from '../src/types.ts';

function makeReport(overrides?: Partial<PreflightReport>): PreflightReport {
  return { results: [], passed: true, durationMs: 0, ...overrides };
}

describe(formatJsonReport, () => {
  it('produces valid JSON', () => {
    const output = formatJsonReport([{ name: 'deploy', report: makeReport() }]);

    expect(() => {
      JSON.parse(output);
    }).not.toThrow();
  });

  it('returns correct summary counts for a single checklist', () => {
    const report = makeReport({
      results: [
        { name: 'a', status: 'passed', durationMs: 10 },
        { name: 'b', status: 'failed', durationMs: 5 },
        { name: 'c', status: 'skipped', durationMs: 0 },
      ],
      passed: false,
      durationMs: 15,
    });

    const parsed: unknown = JSON.parse(formatJsonReport([{ name: 'deploy', report }]));

    expect(parsed).toMatchObject({
      passedCount: 1,
      failedCount: 1,
      skippedCount: 1,
      allPassed: false,
    });
  });

  it('aggregates counts across multiple checklists', () => {
    const report1 = makeReport({
      results: [
        { name: 'a', status: 'passed', durationMs: 10 },
        { name: 'b', status: 'passed', durationMs: 5 },
      ],
      passed: true,
      durationMs: 15,
    });
    const report2 = makeReport({
      results: [{ name: 'c', status: 'failed', durationMs: 3 }],
      passed: false,
      durationMs: 3,
    });

    const parsed: unknown = JSON.parse(
      formatJsonReport([
        { name: 'deploy', report: report1 },
        { name: 'infra', report: report2 },
      ]),
    );

    expect(parsed).toMatchObject({
      passedCount: 2,
      failedCount: 1,
      skippedCount: 0,
      allPassed: false,
      checklists: expect.arrayContaining([expect.anything(), expect.anything()]),
    });
  });

  it('includes checklist-level allPassed and counts', () => {
    const report = makeReport({
      results: [{ name: 'a', status: 'passed', durationMs: 10 }],
      passed: true,
      durationMs: 10,
    });

    const parsed: unknown = JSON.parse(formatJsonReport([{ name: 'deploy', report }]));

    expect(parsed).toMatchObject({
      checklists: [
        {
          name: 'deploy',
          allPassed: true,
          passedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 10,
        },
      ],
    });
  });

  it('sets top-level allPassed to true when checks are skipped but none failed', () => {
    const report = makeReport({
      results: [
        { name: 'a', status: 'skipped', durationMs: 0 },
        { name: 'b', status: 'skipped', durationMs: 0 },
      ],
      passed: true,
      durationMs: 0,
    });

    const parsed: unknown = JSON.parse(formatJsonReport([{ name: 'deploy', report }]));

    expect(parsed).toMatchObject({
      allPassed: true,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 2,
    });
  });

  it('emits the expected top-level shape with no summary wrapper', () => {
    const report = makeReport({
      results: [{ name: 'a', status: 'passed', durationMs: 10 }],
      passed: true,
      durationMs: 10,
    });

    const parsed: unknown = JSON.parse(formatJsonReport([{ name: 'deploy', report }]));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('expected object');
    // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node 20+; engine target is >=18.17.0
    const topLevelKeys = Object.keys(parsed).sort();

    expect(topLevelKeys).toStrictEqual([
      'allPassed',
      'checklists',
      'durationMs',
      'failedCount',
      'passedCount',
      'skippedCount',
    ]);
  });

  it('serializes error as a string message', () => {
    const report = makeReport({
      results: [{ name: 'a', status: 'failed', error: new Error('connection refused'), durationMs: 5 }],
      passed: false,
      durationMs: 5,
    });

    const parsed: unknown = JSON.parse(formatJsonReport([{ name: 'deploy', report }]));

    expect(parsed).toMatchObject({
      checklists: [{ checks: [{ error: 'connection refused' }] }],
    });
  });

  it('omits optional fields when undefined', () => {
    const report = makeReport({
      results: [{ name: 'a', status: 'passed', durationMs: 10 }],
      passed: true,
      durationMs: 10,
    });

    const output = formatJsonReport([{ name: 'deploy', report }]);

    expect(output).not.toContain('"fix"');
    expect(output).not.toContain('"error"');
    expect(output).not.toContain('"detail"');
    expect(output).not.toContain('"progress"');
  });

  it('includes optional fields when present', () => {
    const report = makeReport({
      results: [
        {
          name: 'a',
          status: 'failed',
          fix: 'run npm install',
          detail: 'missing dependency',
          progress: { type: 'fraction', passedCount: 3, count: 5 },
          durationMs: 10,
        },
      ],
      passed: false,
      durationMs: 10,
    });

    const parsed: unknown = JSON.parse(formatJsonReport([{ name: 'deploy', report }]));

    expect(parsed).toMatchObject({
      checklists: [
        {
          checks: [
            {
              fix: 'run npm install',
              detail: 'missing dependency',
              progress: { type: 'fraction', passedCount: 3, count: 5 },
            },
          ],
        },
      ],
    });
  });

  it('serializes percent-based progress', () => {
    const report = makeReport({
      results: [
        {
          name: 'a',
          status: 'passed',
          progress: { type: 'percent', percent: 75 },
          durationMs: 10,
        },
      ],
      passed: true,
      durationMs: 10,
    });

    const parsed: unknown = JSON.parse(formatJsonReport([{ name: 'deploy', report }]));

    expect(parsed).toMatchObject({
      checklists: [{ checks: [{ progress: { type: 'percent', percent: 75 } }] }],
    });
  });
});
