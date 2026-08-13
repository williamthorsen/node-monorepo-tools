import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { Verdict, VerdictOutcome } from '../verdict.ts';
import { renderVerdict, serializeVerdict, VERDICT_LINE_LIMIT, writeVerdict } from '../verdict.ts';

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

  describe('a replayed excerpt', () => {
    it('marks the excerpt as a recording rather than as this run’s output', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: 'Test Files 6 passed (6)', scope: 'nmr-core' }],
      });

      expect(renderVerdict(verdict)).toBe(
        '⏭️ nmr-core: test: passed 4m ago on this tree, saved ~12s — replayed: Test Files 6 passed (6)',
      );
    });

    it('drops the attribution of a lone excerpt the line itself already names', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: '6 passed', scope: 'nmr-core' }],
      });

      expect(renderVerdict(verdict)).not.toContain('nmr-core: test: 6 passed');
    });

    // A composite where one constituent speaks replays one line, and the bare form would present another
    // command's output as the composite's own.
    it('attributes a lone excerpt another command produced', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'fmt:check', excerpt: 'All matched files use Prettier code style!', scope: 'nmr-core' }],
      });

      expect(renderVerdict(verdict)).toBe(
        '⏭️ nmr-core: test: passed 4m ago on this tree, saved ~12s — ' +
          'replayed: nmr-core: fmt:check: All matched files use Prettier code style!',
      );
    });

    it('attributes a lone excerpt another scope produced', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: '6 passed', scope: 'nmr' }],
      });

      expect(renderVerdict(verdict)).toContain('replayed: nmr: test: 6 passed');
    });

    it('attributes each excerpt where several scopes contributed', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [
          { command: 'test:unit', excerpt: '6 passed', scope: 'nmr-core' },
          { command: 'test:unit', excerpt: '4 passed', scope: 'nmr' },
        ],
      });

      expect(renderVerdict(verdict)).toBe(
        '⏭️ nmr-core: test: passed 4m ago on this tree, saved ~12s — ' +
          'replayed: nmr-core: test:unit: 6 passed; nmr: test:unit: 4 passed',
      );
    });

    it.each([
      { replay: undefined, scenario: 'a pass that retained nothing' },
      { replay: [], scenario: 'a replay holding no excerpt' },
    ])('reports the verdict alone for $scenario', ({ replay }) => {
      const verdict = makeVerdict({ outcome: 'recalled', ageMs: 240_000, savedMs: 12_000, ...(replay && { replay }) });

      expect(renderVerdict(verdict)).toBe('⏭️ nmr-core: test: passed 4m ago on this tree, saved ~12s');
    });

    it('collapses the line breaks an excerpt carries, so one verdict stays one line', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: 'first\nsecond', scope: 'nmr-core' }],
      });

      expect(renderVerdict(verdict)).toContain('replayed: first second');
    });

    it('holds a replayed line to the same ceiling, so the single write survives an excerpt', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: 'x'.repeat(VERDICT_LINE_LIMIT), scope: 'nmr-core' }],
      });

      const line = renderVerdict(verdict);

      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT);
      expect(line).toMatch(/…$/);
    });
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

describe(serializeVerdict, () => {
  describe('the field set', () => {
    it.each([
      {
        outcome: { outcome: 'passed', durationMs: 12_449 },
        expected: { command: 'test', scope: 'nmr-core', outcome: 'passed', durationMs: 12_449 },
        scenario: 'a pass',
      },
      {
        outcome: { outcome: 'failed', durationMs: 1_200, exitCode: 130 },
        expected: { command: 'test', scope: 'nmr-core', outcome: 'failed', durationMs: 1_200, exitCode: 130 },
        scenario: 'a failure',
      },
      {
        outcome: { outcome: 'recalled', ageMs: 240_000, savedMs: 12_000 },
        expected: { command: 'test', scope: 'nmr-core', outcome: 'recalled', ageMs: 240_000, savedMs: 12_000 },
        scenario: 'a recalled pass',
      },
      {
        outcome: { outcome: 'no-op', reason: 'empty-override' },
        expected: { command: 'test', scope: 'nmr-core', outcome: 'no-op', reason: 'empty-override' },
        scenario: 'a skipped override',
      },
    ] satisfies { outcome: VerdictOutcome; expected: unknown; scenario: string }[])(
      "carries $scenario as the record's own fields",
      ({ outcome, expected }) => {
        expect(parseVerdict(serializeVerdict(makeVerdict(outcome)))).toStrictEqual(expected);
      },
    );

    // A saving below the threshold the prose line spends a clause on is still a fact the record carries.
    it('carries a saving the prose line declines to name', () => {
      const line = serializeVerdict(makeVerdict({ outcome: 'recalled', ageMs: 1_000, savedMs: 40 }));

      expect(parseVerdict(line)).toMatchObject({ savedMs: 40 });
    });

    it('carries the excerpts a recalled pass replays, each attributed', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: 'Test Files 6 passed (6)', scope: 'nmr-core' }],
      });

      expect(parseVerdict(serializeVerdict(verdict))).toMatchObject({
        replay: [{ command: 'test', excerpt: 'Test Files 6 passed (6)', scope: 'nmr-core' }],
      });
    });

    it('leaves a record within the ceiling uncut', () => {
      const line = serializeVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }));

      expect(line).not.toContain('…');
    });

    it('introduces no escape sequence of its own', () => {
      const line = serializeVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }));

      expect(line).not.toContain('\u{1B}');
    });
  });

  describe('the ceiling', () => {
    it('holds an assembly whose excerpts would overrun to the ceiling, and still parses', () => {
      const line = serializeVerdict(makeAssembly(6, 400));

      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT);
      expect(() => parseVerdict(line)).not.toThrow();
    });

    // Where the prose line composes the whole assembly and drops its tail, the record keeps every
    // constituent and spends the ceiling on shorter excerpts. A `toMatchObject` array holds the record to
    // this length as well as to these scopes.
    it('keeps every constituent of an assembly named', () => {
      expect(parseVerdict(serializeVerdict(makeAssembly(6, 400)))).toMatchObject({
        replay: [
          { scope: 'scope-0' },
          { scope: 'scope-1' },
          { scope: 'scope-2' },
          { scope: 'scope-3' },
          { scope: 'scope-4' },
          { scope: 'scope-5' },
        ],
      });
    });

    it('cuts between code points, so a multi-byte excerpt is never left in halves', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 1_000,
        savedMs: 1_000,
        replay: [{ command: 'test', excerpt: '⏭'.repeat(600), scope: 'nmr-core' }],
      });
      const line = serializeVerdict(verdict);

      expect(line).toBe(Buffer.from(line).toString('utf8'));
      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT);
      expect(() => parseVerdict(line)).not.toThrow();
    });

    it('budgets the detail slot alongside the excerpts', () => {
      const verdict: Verdict = {
        command: 'test',
        scope: 'nmr-core',
        outcome: 'passed',
        durationMs: 12_000,
        detail: 'x'.repeat(2_000),
      };
      const line = serializeVerdict(verdict);

      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT);
      expect(() => parseVerdict(line)).not.toThrow();
    });

    it('surrenders the replay outright where the structural fields alone leave no room for it', () => {
      const verdict: Verdict = {
        command: 'c'.repeat(240),
        scope: 's'.repeat(240),
        outcome: 'recalled',
        ageMs: 1_000,
        savedMs: 1_000,
        replay: [{ command: 'test', excerpt: 'Test Files 6 passed (6)', scope: 'nmr-core' }],
      };
      const parsed = parseVerdict(serializeVerdict(verdict));

      expect(parsed).not.toHaveProperty('replay');
      expect(parsed).toMatchObject({ outcome: 'recalled', ageMs: 1_000, savedMs: 1_000 });
    });
  });
});

describe(writeVerdict, () => {
  it('spends one write on a line, which is what concurrent scopes sharing a descriptor rely on', () => {
    const stream = new PassThrough();
    const write = vi.spyOn(stream, 'write');

    writeVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }), stream, 'text');

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('✅ nmr-core: test: passed in 12s\n');
  });

  it('spends one write on a JSON object too, terminated by the newline that delimits records', () => {
    const stream = new PassThrough();
    const write = vi.spyOn(stream, 'write');

    writeVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }), stream, 'json');

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('{"command":"test","scope":"nmr-core","outcome":"passed","durationMs":12000}\n');
  });
});

// region | Helpers

/** Builds a recalled verdict carrying an assembly wide enough to overrun the ceiling. */
function makeAssembly(constituents: number, excerptLength: number): Verdict {
  return makeVerdict({
    outcome: 'recalled',
    ageMs: 240_000,
    savedMs: 12_000,
    replay: Array.from({ length: constituents }, (_unused, index) => ({
      command: `command-${index}`,
      excerpt: 'x'.repeat(excerptLength),
      scope: `scope-${index}`,
    })),
  });
}

/** Builds a verdict on a fixed scope and command, so a case states only the outcome under test. */
function makeVerdict(outcome: VerdictOutcome): Verdict {
  return { command: 'test', scope: 'nmr-core', ...outcome };
}

/** Parses one serialized verdict, so a case asserts on the record rather than on the bytes. */
function parseVerdict(line: string): unknown {
  const parsed: unknown = JSON.parse(line);

  return parsed;
}

// endregion | Helpers
