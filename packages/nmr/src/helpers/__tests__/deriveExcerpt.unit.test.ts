import { describe, expect, it } from 'vitest';

import { deriveExcerpt } from '../deriveExcerpt.ts';

/** Vitest's closing summary, which the run separates from its per-file progress with a blank line. */
const VITEST_TRANSCRIPT = [
  ' ✓ src/__tests__/resolver.unit.test.ts (18 tests) 12ms',
  ' ✓ src/__tests__/steps.unit.test.ts (9 tests) 4ms',
  '',
  ' Test Files  2 passed (2)',
  '      Tests  27 passed (27)',
  '   Start at  05:26:28',
  '   Duration  2.25s (transform 77ms, setup 0ms)',
  '',
].join('\n');

/** The v8 text reporter's coverage summary, whose rules exist to line the table up vertically. */
const COVERAGE_TRANSCRIPT = [
  ' Test Files  2 passed (2)',
  '',
  ' % Coverage report from v8',
  '-----------|---------|----------|---------|---------|',
  'File       | % Stmts | % Branch | % Funcs | % Lines |',
  '-----------|---------|----------|---------|---------|',
  'All files  |   92.31 |    85.71 |     100 |   92.31 |',
  '-----------|---------|----------|---------|---------|',
  '',
].join('\n');

describe(deriveExcerpt, () => {
  it("given vitest's summary, returns the closing block rather than the per-file progress", () => {
    expect(deriveExcerpt(VITEST_TRANSCRIPT)).toBe(
      'Test Files 2 passed (2) Tests 27 passed (27) Start at 05:26:28 Duration 2.25s (transform 77ms, setup 0ms)',
    );
  });

  it("given the v8 reporter's coverage summary, drops the table rules and keeps the rows", () => {
    expect(deriveExcerpt(COVERAGE_TRANSCRIPT)).toBe(
      '% Coverage report from v8 File | % Stmts | % Branch | % Funcs | % Lines | All files | 92.31 | 85.71 | 100 | 92.31 |',
    );
  });

  it('given a two-line block, returns both lines joined', () => {
    expect(deriveExcerpt('src/index.ts 41ms\nsrc/runner.ts 12ms\n')).toBe('src/index.ts 41ms src/runner.ts 12ms');
  });

  it.each([
    { scenario: 'empty output', transcript: '' },
    { scenario: 'whitespace alone', transcript: '   \n\n  \n' },
    { scenario: 'a block of rules alone', transcript: 'first\n\n-----\n=====\n' },
  ])('given $scenario, returns undefined', ({ transcript }) => {
    expect(deriveExcerpt(transcript)).toBeUndefined();
  });

  it('given a transcript with no blank line, degrades to the last eight lines', () => {
    const transcript = Array.from({ length: 12 }, (_unused, index) => `line ${index + 1}`).join('\n');

    expect(deriveExcerpt(transcript)).toBe('line 5 line 6 line 7 line 8 line 9 line 10 line 11 line 12');
  });

  it('given a block longer than the cap, keeps its final lines rather than its first', () => {
    const block = Array.from({ length: 10 }, (_unused, index) => `summary ${index + 1}`).join('\n');

    expect(deriveExcerpt(`banner\n\n${block}`)).toBe(
      'summary 3 summary 4 summary 5 summary 6 summary 7 summary 8 summary 9 summary 10',
    );
  });

  it.each([
    { form: 'semicolon-separated', setter: '\u{1B}[38;2;255;0;0m' },
    { form: 'colon-separated', setter: '\u{1B}[38:2:255:0:0m' },
  ])('strips a $form color escape, so a replayed line leaves no color behind', ({ setter }) => {
    expect(deriveExcerpt(`progress\n\n${setter}2 failed\u{1B}[39m (2)\n`)).toBe('2 failed (2)');
  });

  it('strips the escape sequences a command writes when it colors piped output', () => {
    const transcript = 'progress\n\n\u{1B}[32m\u{1B}[1m2 passed\u{1B}[22m\u{1B}[39m (2)\n';

    expect(deriveExcerpt(transcript)).toBe('2 passed (2)');
  });

  it('collapses whitespace runs inside a line, so one verdict stays one line', () => {
    expect(deriveExcerpt('Tests\t 27   passed\n')).toBe('Tests 27 passed');
  });

  it('ignores trailing blank lines when locating the closing block', () => {
    expect(deriveExcerpt('banner\n\nthe summary\n\n\n')).toBe('the summary');
  });

  it('given a redrawn progress line, keeps what a reader was left looking at', () => {
    expect(deriveExcerpt('banner\n\nchecking 1/9\rchecking 9/9\rdone in 4s\n')).toBe('done in 4s');
  });

  it('keeps a line ending in a carriage return, which a terminal still shows', () => {
    expect(deriveExcerpt('banner\n\nall good\r\n')).toBe('all good');
  });

  it('cuts an excerpt that would overrun the byte bound, marking the cut', () => {
    const excerpt = deriveExcerpt(`banner\n\n${'x'.repeat(200_000)}\n`);

    expect(Buffer.byteLength(excerpt ?? '')).toBeLessThanOrEqual(2_048);
    expect(excerpt).toMatch(/…$/u);
  });

  it('cuts between code points, so a multi-byte character is never stored in halves', () => {
    const excerpt = deriveExcerpt(`banner\n\n${'⏭'.repeat(2_000)}\n`) ?? '';

    expect(excerpt).toBe(Buffer.from(excerpt).toString('utf8'));
    expect(Buffer.byteLength(excerpt)).toBeLessThanOrEqual(2_048);
  });
});
