import { describe, expect, it } from 'vitest';

import { renderBuildOutcome, renderBuildProgress } from '../build-report.ts';

describe(renderBuildOutcome, () => {
  it.for([
    { style: 'plain', expected: 'pkg: Compiled 4 files to dist/esm.' },
    { style: 'rich', expected: '📦 pkg: Compiled 4 files to dist/esm.' },
  ] as const)('reports an emit in the $style style', ({ style, expected }) => {
    expect(renderBuildOutcome({ kind: 'emitted', fileCount: 4, outdir: 'dist/esm' }, 'pkg', style)).toBe(expected);
  });

  it('names the outdir without its trailing slashes', () => {
    expect(renderBuildOutcome({ kind: 'emitted', fileCount: 2, outdir: 'build//' }, 'pkg', 'plain')).toBe(
      'pkg: Compiled 2 files to build.',
    );
  });

  it('reports an emit that published nothing', () => {
    expect(renderBuildOutcome({ kind: 'emitted', fileCount: 0, outdir: 'dist/esm' }, 'pkg', 'plain')).toBe(
      'pkg: Did not emit any output.',
    );
  });

  it.for([
    { style: 'plain', expected: 'SKIP pkg: No changes detected. Skipping build, saved ~2.1s.' },
    { style: 'rich', expected: '⏩ pkg: No changes detected. Skipping build, saved ~2.1s.' },
  ] as const)('names the saving of a skip of at least a second in the $style style', ({ style, expected }) => {
    expect(renderBuildOutcome({ kind: 'unchanged', savedMs: 2100 }, 'pkg', style)).toBe(expected);
  });

  it.for([
    ['under a second', { kind: 'unchanged', savedMs: 900 }],
    ['absent', { kind: 'unchanged' }],
  ] as const)('omits the saving of a skip when it is %s', ([, outcome]) => {
    expect(renderBuildOutcome(outcome, 'pkg', 'plain')).toBe('SKIP pkg: No changes detected. Skipping build.');
  });
});

describe(renderBuildProgress, () => {
  it.for([
    { kind: 'inputs-changed', style: 'plain', expected: 'pkg: Changes detected.' },
    { kind: 'inputs-changed', style: 'rich', expected: '📦 pkg: Changes detected.' },
    { kind: 'output-missing', style: 'plain', expected: 'pkg: Build output is missing. Rebuilding.' },
    { kind: 'output-missing', style: 'rich', expected: '📦 pkg: Build output is missing. Rebuilding.' },
  ] as const)('reports $kind in the $style style', ({ kind, style, expected }) => {
    expect(renderBuildProgress({ kind }, 'pkg', style)).toBe(expected);
  });
});
