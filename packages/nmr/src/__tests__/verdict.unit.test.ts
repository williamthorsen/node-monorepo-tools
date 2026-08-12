import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { Verdict, VerdictOutcome } from '../verdict.ts';
import { renderVerdict, VERDICT_LINE_LIMIT, writeVerdict } from '../verdict.ts';

describe(renderVerdict, () => {
  it('reports a pass with its scope, command, and duration', () => {
    expect(renderVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_449 }))).toBe(
      '✅ nmr-core: test: passed in 12.4s',
    );
  });

  it('reports a failure with the exit code, which separates an interrupt from a real failure', () => {
    const verdict = makeVerdict({ outcome: 'failed', durationMs: 1_200, exitCode: 130 });

    expect(renderVerdict(verdict)).toBe('❌ nmr-core: test: failed in 1.2s (exit 130)');
  });

  it('reports a recalled pass with its age and saving', () => {
    const verdict = makeVerdict({ outcome: 'recalled', ageMs: 240_000, savedMs: 12_000 });

    expect(renderVerdict(verdict)).toBe('⏭️ nmr-core: test: passed 4m ago on this tree, saved ~12s');
  });

  it('drops the saving clause when the recalled pass was too quick to have saved anything', () => {
    const verdict = makeVerdict({ outcome: 'recalled', ageMs: 240_000, savedMs: 40 });

    expect(renderVerdict(verdict)).toBe('⏭️ nmr-core: test: passed 4m ago on this tree');
  });

  it.each([
    ['empty-override', '⛔ nmr-core: test: skipped, the override is empty'],
    ['noop-override', '⛔ nmr-core: test: skipped, the override is a no-op'],
  ] as const)('distinguishes the %s from a pass', (reason, expected) => {
    expect(renderVerdict(makeVerdict({ outcome: 'no-op', reason }))).toBe(expected);
  });

  it('ends without terminal punctuation, so a later change appends to the line', () => {
    const line = renderVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }));

    expect(line).not.toMatch(/[.!?]$/);
  });

  it('appends the detail to the tail the grammar reserves for it', () => {
    const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: 'Test Files 6 passed (6)' });

    expect(renderVerdict(verdict)).toBe('✅ nmr-core: test: passed in 12s — Test Files 6 passed (6)');
  });

  describe('a detail lifted from command output', () => {
    it('collapses the line breaks it carries, so one verdict stays one line', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: 'line one\nline two' });

      expect(renderVerdict(verdict)).toBe('✅ nmr-core: test: passed in 12s — line one line two');
    });

    it('spends one space on a run of them, and none on the ones bounding the text', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: '\r\nfirst\r\n\r\nsecond\n' });

      expect(renderVerdict(verdict)).toBe('✅ nmr-core: test: passed in 12s — first second');
    });

    it.each([
      { detail: '', scenario: 'an empty detail' },
      { detail: '\n\n', scenario: 'a detail that was nothing but line breaks' },
    ])('drops the whole clause for $scenario, rather than pointing a separator at nothing', ({ detail }) => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail });

      expect(renderVerdict(verdict)).toBe('✅ nmr-core: test: passed in 12s');
    });
  });

  describe('the byte ceiling', () => {
    it('leaves room for the newline the write appends', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: 'x'.repeat(VERDICT_LINE_LIMIT) });

      expect(Buffer.byteLength(renderVerdict(verdict)) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT);
    });

    it('marks the cut, so a truncated line is distinguishable from a complete one', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: 'x'.repeat(VERDICT_LINE_LIMIT) });

      expect(renderVerdict(verdict)).toMatch(/…$/);
    });

    it('cuts between code points, so a multi-byte character never reaches the wire in halves', () => {
      // Every unit is three bytes, so a byte-wise cut would land inside one for two budgets out of three.
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: '⏭'.repeat(VERDICT_LINE_LIMIT) });

      const line = renderVerdict(verdict);

      expect(line).toBe(Buffer.from(line).toString('utf8'));
      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT);
    });

    it('leaves a line within the ceiling untouched', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000 });

      expect(renderVerdict(verdict)).not.toContain('…');
    });
  });
});

describe(writeVerdict, () => {
  it('spends one write on a line, which is what concurrent scopes sharing a descriptor rely on', () => {
    const stream = new PassThrough();
    const write = vi.spyOn(stream, 'write');

    writeVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }), stream);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('✅ nmr-core: test: passed in 12s\n');
  });
});

// region | Helpers

/** Builds a verdict on a fixed scope and command, so a case states only the outcome under test. */
function makeVerdict(outcome: VerdictOutcome): Verdict {
  return { command: 'test', scope: 'nmr-core', ...outcome };
}

// endregion | Helpers
