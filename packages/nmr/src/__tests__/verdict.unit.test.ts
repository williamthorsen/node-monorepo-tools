import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  renderVerdict,
  serializeVerdict,
  type Verdict,
  VERDICT_LINE_LIMIT_BYTES,
  type VerdictOutcome,
  writeVerdict,
} from '../verdict.ts';

describe(renderVerdict, () => {
  it('reports a pass with its scope, command, and duration', () => {
    expect(renderVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_449 }), 'rich')).toBe(
      '✅ nmr-core: test: passed in 12.4s',
    );
  });

  it('reports a failure with the exit code, which separates an interrupt from a real failure', () => {
    const verdict = makeVerdict({ outcome: 'failed', durationMs: 1_200, exitCode: 130 });

    expect(renderVerdict(verdict, 'rich')).toBe('❌ nmr-core: test: failed in 1.2s (exit 130)');
  });

  it('reports a recalled pass with its age and saving', () => {
    const verdict = makeVerdict({ outcome: 'recalled', ageMs: 240_000, savedMs: 12_000 });

    expect(renderVerdict(verdict, 'rich')).toBe('⏩ nmr-core: test: passed 4m ago on this tree, saved ~12s');
  });

  it('drops the saving clause when the recalled pass was too quick to have saved anything', () => {
    const verdict = makeVerdict({ outcome: 'recalled', ageMs: 240_000, savedMs: 40 });

    expect(renderVerdict(verdict, 'rich')).toBe('⏩ nmr-core: test: passed 4m ago on this tree');
  });

  it.each([
    ['empty-override', '⚪ nmr-core: test: skipped, the override is empty'],
    ['empty-workspace', '⚪ nmr-core: test: skipped, the workspace does not declare any package'],
    ['noop-override', '⚪ nmr-core: test: skipped, the override is a no-op'],
  ] as const)('distinguishes the %s from a pass', (reason, expectedLine) => {
    expect(renderVerdict(makeVerdict({ outcome: 'no-op', reason }), 'rich')).toBe(expectedLine);
  });

  it('ends without terminal punctuation, so that a later change can append to the line', () => {
    const line = renderVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }), 'rich');

    expect(line).not.toMatch(/[.!?]$/);
  });

  it('appends the detail to the tail that the grammar reserves for it', () => {
    const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: 'Test Files 6 passed (6)' });

    expect(renderVerdict(verdict, 'rich')).toBe('✅ nmr-core: test: passed in 12s — Test Files 6 passed (6)');
  });

  describe('a replayed excerpt', () => {
    it('marks the excerpt as a recording rather than as this run’s output', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: 'Test Files 6 passed (6)', scope: 'nmr-core' }],
      });

      expect(renderVerdict(verdict, 'rich')).toBe(
        '⏩ nmr-core: test: passed 4m ago on this tree, saved ~12s — replayed: Test Files 6 passed (6)',
      );
    });

    it('drops the attribution of a lone excerpt that the line itself already names', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: '6 passed', scope: 'nmr-core' }],
      });

      expect(renderVerdict(verdict, 'rich')).not.toContain('nmr-core: test: 6 passed');
    });

    // A composite with a single constituent that produced an excerpt replays one line, and the bare form would
    // present another command's output as the composite's own.
    it('attributes a lone excerpt produced by another command', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'fmt:check', excerpt: 'All matched files use Prettier code style!', scope: 'nmr-core' }],
      });

      expect(renderVerdict(verdict, 'rich')).toBe(
        '⏩ nmr-core: test: passed 4m ago on this tree, saved ~12s — ' +
          'replayed: nmr-core: fmt:check: All matched files use Prettier code style!',
      );
    });

    it('attributes a lone excerpt produced by another scope', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: '6 passed', scope: 'nmr' }],
      });

      expect(renderVerdict(verdict, 'rich')).toContain('replayed: nmr: test: 6 passed');
    });

    it('attributes each excerpt when several scopes contributed', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [
          { command: 'test:unit', excerpt: '6 passed', scope: 'nmr-core' },
          { command: 'test:unit', excerpt: '4 passed', scope: 'nmr' },
        ],
      });

      expect(renderVerdict(verdict, 'rich')).toBe(
        '⏩ nmr-core: test: passed 4m ago on this tree, saved ~12s — ' +
          'replayed: nmr-core: test:unit: 6 passed; nmr: test:unit: 4 passed',
      );
    });

    it.each([
      { replay: undefined, scenario: 'a pass that retained nothing' },
      { replay: [], scenario: 'a replay without an excerpt' },
    ])('reports the verdict alone for $scenario', ({ replay }) => {
      const verdict = makeVerdict({ outcome: 'recalled', ageMs: 240_000, savedMs: 12_000, ...(replay && { replay }) });

      expect(renderVerdict(verdict, 'rich')).toBe('⏩ nmr-core: test: passed 4m ago on this tree, saved ~12s');
    });

    it('collapses the line breaks in an excerpt, so that one verdict stays one line', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: 'first\nsecond', scope: 'nmr-core' }],
      });

      expect(renderVerdict(verdict, 'rich')).toContain('replayed: first second');
    });

    it('holds a replayed line to the same ceiling, so that a line with an excerpt still takes a single write', () => {
      const verdict = makeVerdict({
        outcome: 'recalled',
        ageMs: 240_000,
        savedMs: 12_000,
        replay: [{ command: 'test', excerpt: 'x'.repeat(VERDICT_LINE_LIMIT_BYTES), scope: 'nmr-core' }],
      });

      const line = renderVerdict(verdict, 'rich');

      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT_BYTES);
      expect(line).toMatch(/…$/);
    });
  });

  describe('a detail lifted from command output', () => {
    it('collapses its line breaks, so that one verdict stays one line', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: 'line one\nline two' });

      expect(renderVerdict(verdict, 'rich')).toBe('✅ nmr-core: test: passed in 12s — line one line two');
    });

    it('spends one space on a run of them, and none on the ones bounding the text', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: '\r\nfirst\r\n\r\nsecond\n' });

      expect(renderVerdict(verdict, 'rich')).toBe('✅ nmr-core: test: passed in 12s — first second');
    });

    it.each([
      { detail: '', scenario: 'an empty detail' },
      { detail: '\n\n', scenario: 'a detail that was nothing but line breaks' },
    ])('drops the whole clause for $scenario, rather than pointing a separator at nothing', ({ detail }) => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail });

      expect(renderVerdict(verdict, 'rich')).toBe('✅ nmr-core: test: passed in 12s');
    });
  });

  describe('the plain style', () => {
    it.each([
      { expectedLine: 'PASS nmr-core: test: passed in 12s', outcome: { outcome: 'passed', durationMs: 12_000 } },
      {
        expectedLine: 'FAIL nmr-core: test: failed in 1.2s (exit 130)',
        outcome: { outcome: 'failed', durationMs: 1_200, exitCode: 130 },
      },
      {
        expectedLine: 'SKIP nmr-core: test: passed 4m ago on this tree, saved ~12s',
        outcome: { outcome: 'recalled', ageMs: 240_000, savedMs: 12_000 },
      },
      {
        expectedLine: 'NOOP nmr-core: test: skipped, the override is empty',
        outcome: { outcome: 'no-op', reason: 'empty-override' },
      },
    ] satisfies { expectedLine: string; outcome: VerdictOutcome }[])(
      'renders `$expectedLine`',
      ({ expectedLine, outcome }) => {
        expect(renderVerdict(makeVerdict(outcome), 'plain')).toBe(expectedLine);
      },
    );

    it('keeps the detail clause and its separator, which the style does not govern', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000, detail: 'Test Files 6 passed (6)' });

      expect(renderVerdict(verdict, 'plain')).toBe('PASS nmr-core: test: passed in 12s — Test Files 6 passed (6)');
    });
  });

  describe('the byte ceiling', () => {
    it('leaves room for the newline that the write appends', () => {
      const verdict = makeVerdict({
        outcome: 'passed',
        durationMs: 12_000,
        detail: 'x'.repeat(VERDICT_LINE_LIMIT_BYTES),
      });

      expect(Buffer.byteLength(renderVerdict(verdict, 'rich')) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT_BYTES);
    });

    it('marks the cut, so that a truncated line is distinguishable from a complete one', () => {
      const verdict = makeVerdict({
        outcome: 'passed',
        durationMs: 12_000,
        detail: 'x'.repeat(VERDICT_LINE_LIMIT_BYTES),
      });

      expect(renderVerdict(verdict, 'rich')).toMatch(/…$/);
    });

    it('cuts between code points, so that a multi-byte character is never written in halves', () => {
      // Every unit is three bytes, so a byte-wise cut would fall inside one for two budgets out of three.
      const verdict = makeVerdict({
        outcome: 'passed',
        durationMs: 12_000,
        detail: '⏭'.repeat(VERDICT_LINE_LIMIT_BYTES),
      });

      const line = renderVerdict(verdict, 'rich');

      expect(line).toBe(Buffer.from(line).toString('utf8'));
      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT_BYTES);
    });

    it('leaves a line within the ceiling untouched', () => {
      const verdict = makeVerdict({ outcome: 'passed', durationMs: 12_000 });

      expect(renderVerdict(verdict, 'rich')).not.toContain('…');
    });
  });
});

describe(serializeVerdict, () => {
  describe('the field set', () => {
    it.each([
      {
        outcome: { outcome: 'passed', durationMs: 12_449 },
        expectedRecord: { command: 'test', scope: 'nmr-core', outcome: 'passed', durationMs: 12_449 },
        scenario: 'a pass',
      },
      {
        outcome: { outcome: 'failed', durationMs: 1_200, exitCode: 130 },
        expectedRecord: { command: 'test', scope: 'nmr-core', outcome: 'failed', durationMs: 1_200, exitCode: 130 },
        scenario: 'a failure',
      },
      {
        outcome: { outcome: 'recalled', ageMs: 240_000, savedMs: 12_000 },
        expectedRecord: { command: 'test', scope: 'nmr-core', outcome: 'recalled', ageMs: 240_000, savedMs: 12_000 },
        scenario: 'a recalled pass',
      },
      {
        outcome: { outcome: 'no-op', reason: 'empty-override' },
        expectedRecord: { command: 'test', scope: 'nmr-core', outcome: 'no-op', reason: 'empty-override' },
        scenario: 'a skipped override',
      },
    ] satisfies { outcome: VerdictOutcome; expectedRecord: unknown; scenario: string }[])(
      "serializes $scenario as the record's own fields",
      ({ outcome, expectedRecord }) => {
        expect(parseVerdict(serializeVerdict(makeVerdict(outcome)))).toStrictEqual(expectedRecord);
      },
    );

    // A saving below the prose line's threshold for a clause is still a fact that the record contains.
    it('includes a saving that the prose line declines to name', () => {
      const line = serializeVerdict(makeVerdict({ outcome: 'recalled', ageMs: 1_000, savedMs: 40 }));

      expect(parseVerdict(line)).toMatchObject({ savedMs: 40 });
    });

    it('includes the excerpts that a recalled pass replays, each attributed', () => {
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

    it('does not introduce an escape sequence of its own', () => {
      const line = serializeVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }));

      expect(line).not.toContain('\u{1B}');
    });
  });

  describe('the ceiling', () => {
    it('holds an assembly whose excerpts would overrun to the ceiling, and still parses', () => {
      const line = serializeVerdict(makeAssembly(6, 400));

      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT_BYTES);
      expect(() => parseVerdict(line)).not.toThrow();
    });

    // Whereas the prose line composes the whole assembly and drops its tail, the record keeps every
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
      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT_BYTES);
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

      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT_BYTES);
      expect(() => parseVerdict(line)).not.toThrow();
    });

    it('drops the replay outright when the structural fields alone do not leave room for it', () => {
      const parsedVerdict = parseVerdict(serializeVerdict(OVERSIZED_STRUCTURE));

      expect(parsedVerdict).not.toHaveProperty('replay');
      expect(parsedVerdict).toMatchObject({ outcome: 'recalled', ageMs: 1_000, savedMs: 1_000 });
    });

    // The scope and the command are the last fields that `serializeVerdict` drops from a record, and it does drop
    // them: A line that overruns can be split across a pipe and corrupt every scope's records, whereas a marked cut
    // damages only one.
    it('stays within the ceiling when the structural fields alone overrun it', () => {
      const line = serializeVerdict(OVERSIZED_STRUCTURE);

      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT_BYTES);
      expect(() => parseVerdict(line)).not.toThrow();
      expect(line).toContain('…');
    });

    // The widest assembly of this shape that the record still names in full within the ceiling.
    it('keeps every constituent named when the ceiling has room for them all', () => {
      const parsedVerdict = parseVerdict(serializeVerdict(makeAssembly(8, 49)));

      expect(readScopes(parsedVerdict)).toStrictEqual([
        'scope-0',
        'scope-1',
        'scope-2',
        'scope-3',
        'scope-4',
        'scope-5',
        'scope-6',
        'scope-7',
      ]);
    });

    // A four-package root `check` assembles twelve: `typecheck` and `test` each fan out to every package, and
    // `assembleReplay` splices a nested composite's list in flat. Twelve is more than the ceiling has room to name,
    // so `serializeVerdict` drops the tail rather than the array, and what is left still parses inside the ceiling.
    it('drops the trailing constituents at a width too wide for the ceiling to name them all', () => {
      const line = serializeVerdict(makeAssembly(12, 49));

      expect(readScopes(parseVerdict(line))).toStrictEqual([
        'scope-0',
        'scope-1',
        'scope-2',
        'scope-3',
        'scope-4',
        'scope-5',
        'scope-6',
        'scope-7',
        'scope-8',
      ]);
      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(VERDICT_LINE_LIMIT_BYTES);
    });

    it('sheds the excerpts before the constituents that contain them', () => {
      const parsedVerdict = parseVerdict(serializeVerdict(makeAssembly(8, 49)));

      expect(readExcerpts(parsedVerdict)).toStrictEqual([]);
      expect(readScopes(parsedVerdict)).toHaveLength(8);
    });

    // `serializeVerdict` shares the overrun rather than emptying one constituent to leave a later one whole: Step
    // order does not mean anything to a consumer.
    it("cuts an assembly's excerpts down together rather than spending the overrun on the first", () => {
      const lengths = readExcerpts(parseVerdict(serializeVerdict(makeAssembly(4, 200)))).map(
        (excerpt) => excerpt.length,
      );

      // Comparable rather than equal: Because the share is integer arithmetic, the last cut absorbs the remainder.
      expect(lengths).toHaveLength(4);
      expect(Math.min(...lengths) * 2).toBeGreaterThanOrEqual(Math.max(...lengths));
    });

    // An excerpt cut to nothing reads as a run that recorded nothing, which is a different fact.
    it('leaves every cut excerpt marked rather than emptied', () => {
      const excerpts = readExcerpts(parseVerdict(serializeVerdict(makeAssembly(4, 200))));

      expect(excerpts.every((excerpt) => excerpt.endsWith('…'))).toBe(true);
      expect(excerpts).not.toContain('');
    });
  });
});

describe(writeVerdict, () => {
  it('spends one write on a line, on which concurrent scopes sharing a descriptor rely', () => {
    const stream = new PassThrough();
    const write = vi.spyOn(stream, 'write');

    writeVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }), stream, 'text', 'rich');

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('✅ nmr-core: test: passed in 12s\n');
  });

  it('spends one write on a JSON object too, terminated by the newline that delimits records', () => {
    const stream = new PassThrough();
    const write = vi.spyOn(stream, 'write');

    writeVerdict(makeVerdict({ outcome: 'passed', durationMs: 12_000 }), stream, 'json', 'rich');

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('{"command":"test","scope":"nmr-core","outcome":"passed","durationMs":12000}\n');
  });
});

// region | Helpers

/** A verdict whose scope and command alone overrun the ceiling, leaving nothing structural left to shed. */
const OVERSIZED_STRUCTURE: Verdict = {
  command: 'c'.repeat(240),
  scope: 's'.repeat(240),
  outcome: 'recalled',
  ageMs: 1_000,
  savedMs: 1_000,
  replay: [{ command: 'test', excerpt: 'Test Files 6 passed (6)', scope: 'nmr-core' }],
};

/** Reads the excerpts in a parsed record's replay, skipping an entry from which the ladder shed the excerpt. */
function readExcerpts(parsedVerdict: unknown): string[] {
  return readReplay(parsedVerdict).flatMap((line) => (typeof line['excerpt'] === 'string' ? [line['excerpt']] : []));
}

/** Reports whether a replay entry parsed back as an object, as every one that nmr emits does. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Builds a recalled verdict with an assembly wide enough to overrun the ceiling. */
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

/** Builds a verdict on a fixed scope and command, so that a case states only the outcome under test. */
function makeVerdict(outcome: VerdictOutcome): Verdict {
  return { command: 'test', scope: 'nmr-core', ...outcome };
}

/** Parses one serialized verdict, so that a case asserts on the record rather than on the bytes. */
function parseVerdict(line: string): unknown {
  const parsedVerdict: unknown = JSON.parse(line);

  return parsedVerdict;
}

/** Reads the replay entries in a parsed record, or none when the ladder shed the array. */
function readReplay(parsedVerdict: unknown): Record<string, unknown>[] {
  if (typeof parsedVerdict !== 'object' || parsedVerdict === null || !('replay' in parsedVerdict)) {
    return [];
  }
  const { replay } = parsedVerdict;

  return Array.isArray(replay) ? replay.filter(isRecord) : [];
}

/** Reads the scope named by each constituent of a parsed record's replay. */
function readScopes(parsedVerdict: unknown): string[] {
  return readReplay(parsedVerdict).flatMap((line) => (typeof line['scope'] === 'string' ? [line['scope']] : []));
}

// endregion | Helpers
