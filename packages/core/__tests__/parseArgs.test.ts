import { describe, expect, it } from 'vitest';

import type { FlagSchema } from '../src/parseArgs.ts';
import { parseArgs } from '../src/parseArgs.ts';

const emptySchema = {} satisfies FlagSchema;

const mixedSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  output: { long: '--output', type: 'string' as const, short: '-o' },
  verbose: { long: '--verbose', type: 'boolean' as const, short: '-v' },
};

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
      const result = parseArgs(['--dry-run'], mixedSchema);

      expect(result.flags.dryRun).toBe(true);
    });

    it('sets boolean flag to true when present via short alias', () => {
      const result = parseArgs(['-v'], mixedSchema);

      expect(result.flags.verbose).toBe(true);
    });

    it('defaults boolean flags to false when absent', () => {
      const result = parseArgs(['positional'], mixedSchema);

      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.verbose).toBe(false);
    });

    it('throws when boolean flag is given a value via = form', () => {
      expect(() => parseArgs(['--dry-run=true'], mixedSchema)).toThrow("flag '--dry-run' does not accept a value");
    });
  });

  describe('string flags', () => {
    it('parses --flag=value form', () => {
      const result = parseArgs(['--output=dist/out.js'], mixedSchema);

      expect(result.flags.output).toBe('dist/out.js');
    });

    it('parses --flag value (space-separated) form', () => {
      const result = parseArgs(['--output', 'dist/out.js'], mixedSchema);

      expect(result.flags.output).toBe('dist/out.js');
    });

    it('parses short alias with space-separated value', () => {
      const result = parseArgs(['-o', 'dist/out.js'], mixedSchema);

      expect(result.flags.output).toBe('dist/out.js');
    });

    it('throws when --flag= has an empty value', () => {
      expect(() => parseArgs(['--output='], mixedSchema)).toThrow('--output requires a value');
    });

    it('throws when string flag is at end of argv with no value', () => {
      expect(() => parseArgs(['--output'], mixedSchema)).toThrow('--output requires a value');
    });

    it('throws when string flag is followed by another flag', () => {
      expect(() => parseArgs(['--output', '--dry-run'], mixedSchema)).toThrow('--output requires a value');
    });

    it('defaults string flags to undefined when absent', () => {
      const result = parseArgs([], mixedSchema);

      expect(result.flags.output).toBeUndefined();
    });
  });

  describe('unknown flags', () => {
    it('throws for unknown long flag', () => {
      expect(() => parseArgs(['--unknown'], mixedSchema)).toThrow("unknown flag '--unknown'");
    });

    it('throws for unknown short flag', () => {
      expect(() => parseArgs(['-x'], mixedSchema)).toThrow("unknown flag '-x'");
    });

    it('throws for unknown long flag with = form', () => {
      expect(() => parseArgs(['--unknown=val'], mixedSchema)).toThrow("unknown flag '--unknown'");
    });
  });

  describe('positionals', () => {
    it('collects positional arguments in order', () => {
      const result = parseArgs(['foo', 'bar', 'baz'], emptySchema);

      expect(result.positionals).toStrictEqual(['foo', 'bar', 'baz']);
    });

    it('treats bare - as a positional, not a flag', () => {
      const result = parseArgs(['-'], emptySchema);

      expect(result.positionals).toStrictEqual(['-']);
    });

    it('collects positionals interleaved with flags', () => {
      const result = parseArgs(['foo', '--dry-run', 'bar'], mixedSchema);

      expect(result.positionals).toStrictEqual(['foo', 'bar']);
      expect(result.flags.dryRun).toBe(true);
    });
  });

  describe('-- delimiter', () => {
    it('stops flag parsing after --', () => {
      const result = parseArgs(['--dry-run', '--', '--output', 'val'], mixedSchema);

      expect(result.flags.dryRun).toBe(true);
      expect(result.flags.output).toBeUndefined();
      expect(result.positionals).toStrictEqual(['--output', 'val']);
    });

    it('treats everything after -- as positionals', () => {
      const result = parseArgs(['--', '--unknown'], emptySchema);

      expect(result.positionals).toStrictEqual(['--unknown']);
    });
  });

  describe('string flag accepts bare - as a value', () => {
    it('treats - as a valid string value (stdin convention)', () => {
      const result = parseArgs(['--output', '-'], mixedSchema);

      expect(result.flags.output).toBe('-');
    });
  });

  describe('empty schema', () => {
    it('treats all non-flag args as positionals', () => {
      const result = parseArgs(['a', 'b'], emptySchema);

      expect(result.positionals).toStrictEqual(['a', 'b']);
    });

    it('throws on any flag', () => {
      expect(() => parseArgs(['--anything'], emptySchema)).toThrow("unknown flag '--anything'");
    });
  });
});
