import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlagSchema, ParseErrorKind } from '../parseArgs.ts';
import { parseArgs, parseArgsOrExit, ParseError } from '../parseArgs.ts';

const emptySchema = {} satisfies FlagSchema;

const mixedSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  output: { long: '--output', type: 'string' as const, short: '-o' },
  verbose: { long: '--verbose', type: 'boolean' as const, short: '-v' },
};

/** Asserts that parsing throws a `ParseError` with the given kind and flag, and returns it. */
function expectParseError(argv: string[], schema: FlagSchema, kind: ParseErrorKind, flag: string): ParseError {
  let thrown: unknown;
  try {
    parseArgs(argv, schema);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ParseError);
  if (!(thrown instanceof ParseError)) {
    throw new Error('expected parseArgs to throw a ParseError');
  }
  expect(thrown.kind).toBe(kind);
  expect(thrown.flag).toBe(flag);
  return thrown;
}

describe(parseArgs, () => {
  describe('empty argv', () => {
    it('returns default flags and empty positionals', () => {
      const result = parseArgs([], mixedSchema);

      expect(result.flags).toStrictEqual({ dryRun: false, output: undefined, verbose: false });
      expect(result.positionals).toStrictEqual([]);
    });
  });

  describe('boolean flags', () => {
    it('sets boolean flag to true when present via long form', () => {
      expect(parseArgs(['--dry-run'], mixedSchema).flags.dryRun).toBe(true);
    });

    it('sets boolean flag to true when present via short alias', () => {
      expect(parseArgs(['-v'], mixedSchema).flags.verbose).toBe(true);
    });

    it('defaults boolean flags to false when absent', () => {
      const result = parseArgs(['--output', 'dist/out.js'], mixedSchema);

      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.verbose).toBe(false);
    });

    it('throws unexpected-value when a boolean flag is given a value via = form', () => {
      const error = expectParseError(['--dry-run=true'], mixedSchema, 'unexpected-value', '--dry-run');
      expect(error.message).toBe('Option does not accept a value: --dry-run');
    });
  });

  describe('string flags', () => {
    it('parses --flag=value form', () => {
      expect(parseArgs(['--output=dist/out.js'], mixedSchema).flags.output).toBe('dist/out.js');
    });

    it('parses --flag value (space-separated) form', () => {
      expect(parseArgs(['--output', 'dist/out.js'], mixedSchema).flags.output).toBe('dist/out.js');
    });

    it('parses short alias with space-separated value', () => {
      expect(parseArgs(['-o', 'dist/out.js'], mixedSchema).flags.output).toBe('dist/out.js');
    });

    it('throws missing-value when --flag= has an empty value', () => {
      const error = expectParseError(['--output='], mixedSchema, 'missing-value', '--output');
      expect(error.message).toBe('Missing value for option: --output');
    });

    it('throws missing-value when a string flag is at end of argv with no value', () => {
      expectParseError(['--output'], mixedSchema, 'missing-value', '--output');
    });

    it('throws missing-value when a string flag is followed by another flag', () => {
      expectParseError(['--output', '--dry-run'], mixedSchema, 'missing-value', '--output');
    });

    it('defaults string flags to undefined when absent', () => {
      expect(parseArgs([], mixedSchema).flags.output).toBeUndefined();
    });

    it('treats bare - as a valid string value (stdin convention)', () => {
      expect(parseArgs(['--output', '-'], mixedSchema).flags.output).toBe('-');
    });
  });

  describe('unknown flags', () => {
    it('throws unknown-flag for an unknown long flag', () => {
      const error = expectParseError(['--unknown'], mixedSchema, 'unknown-flag', '--unknown');
      expect(error.message).toBe('Unknown option: --unknown');
    });

    it('throws unknown-flag for an unknown short flag, echoing the typed form', () => {
      expectParseError(['-x'], mixedSchema, 'unknown-flag', '-x');
    });

    it('throws unknown-flag for an unknown long flag in = form', () => {
      expectParseError(['--unknown=val'], mixedSchema, 'unknown-flag', '--unknown');
    });
  });

  describe('positionals', () => {
    it('rejects an unexpected positional by default', () => {
      const error = expectParseError(['foo'], emptySchema, 'unexpected-positional', 'foo');
      expect(error.message).toBe('Unexpected positional argument: foo');
    });

    it('reports the first positional when several are present', () => {
      expectParseError(['foo', 'bar', 'baz'], emptySchema, 'unexpected-positional', 'foo');
    });

    it('rejects a positional interleaved with valid flags, reporting the positional', () => {
      expectParseError(['foo', '--dry-run', 'bar'], mixedSchema, 'unexpected-positional', 'foo');
    });

    it('rejects bare - as an unexpected positional by default', () => {
      expectParseError(['-'], emptySchema, 'unexpected-positional', '-');
    });

    it('collects positionals in order when allowPositionals is set', () => {
      expect(parseArgs(['foo', 'bar', 'baz'], emptySchema, { allowPositionals: true }).positionals).toStrictEqual([
        'foo',
        'bar',
        'baz',
      ]);
    });

    it('collects positionals interleaved with flags when allowPositionals is set', () => {
      const result = parseArgs(['foo', '--dry-run', 'bar'], mixedSchema, { allowPositionals: true });

      expect(result.positionals).toStrictEqual(['foo', 'bar']);
      expect(result.flags.dryRun).toBe(true);
    });

    it('treats bare - as a positional, not a flag, when allowPositionals is set', () => {
      expect(parseArgs(['-'], emptySchema, { allowPositionals: true }).positionals).toStrictEqual(['-']);
    });
  });

  describe('-- delimiter', () => {
    it('rejects positionals after -- by default', () => {
      expectParseError(['--dry-run', '--', '--output', 'val'], mixedSchema, 'unexpected-positional', '--output');
    });

    it('collects everything after -- as positionals when allowPositionals is set', () => {
      const result = parseArgs(['--dry-run', '--', '--output', 'val'], mixedSchema, { allowPositionals: true });

      expect(result.flags.dryRun).toBe(true);
      expect(result.flags.output).toBeUndefined();
      expect(result.positionals).toStrictEqual(['--output', 'val']);
    });

    it('treats everything after -- as positionals when allowPositionals is set', () => {
      expect(parseArgs(['--', '--unknown'], emptySchema, { allowPositionals: true }).positionals).toStrictEqual([
        '--unknown',
      ]);
    });
  });

  describe('empty schema', () => {
    it('rejects non-flag args as unexpected positionals by default', () => {
      expectParseError(['a', 'b'], emptySchema, 'unexpected-positional', 'a');
    });

    it('treats all non-flag args as positionals when allowPositionals is set', () => {
      expect(parseArgs(['a', 'b'], emptySchema, { allowPositionals: true }).positionals).toStrictEqual(['a', 'b']);
    });

    it('throws unknown-flag on any flag', () => {
      expectParseError(['--anything'], emptySchema, 'unknown-flag', '--anything');
    });
  });

  describe('short-flag clustering', () => {
    const clusterSchema = {
      all: { long: '--all', type: 'boolean' as const, short: '-a' },
      build: { long: '--build', type: 'boolean' as const, short: '-b' },
    };

    it('expands clustered short boolean flags', () => {
      const result = parseArgs(['-ab'], clusterSchema);

      expect(result.flags.all).toBe(true);
      expect(result.flags.build).toBe(true);
    });

    it('throws unknown-flag for an unknown flag inside a cluster', () => {
      expectParseError(['-ax'], clusterSchema, 'unknown-flag', '-x');
    });
  });
});

describe(parseArgsOrExit, () => {
  /** Sentinel error thrown by the mocked process.exit. */
  class ExitError extends Error {
    constructor(public readonly code: number | undefined) {
      super(`process.exit(${code})`);
    }
  }

  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the parsed result when parsing succeeds', () => {
    const result = parseArgsOrExit(['--dry-run'], mixedSchema);

    expect(result.flags.dryRun).toBe(true);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('prints a usage error and exits with code 1 on a parse failure', () => {
    expect(() => parseArgsOrExit(['--unknown'], mixedSchema)).toThrow(ExitError);

    expect(process.stderr.write).toHaveBeenCalledWith('Error: Unknown option: --unknown\n');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('prints a usage error and exits with code 1 on an unexpected positional', () => {
    expect(() => parseArgsOrExit(['extra'], mixedSchema)).toThrow(ExitError);

    expect(process.stderr.write).toHaveBeenCalledWith('Error: Unexpected positional argument: extra\n');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('returns the parsed result when positionals are allowed', () => {
    const result = parseArgsOrExit(['extra'], emptySchema, { allowPositionals: true });

    expect(result.positionals).toStrictEqual(['extra']);
    expect(process.exit).not.toHaveBeenCalled();
  });
});
