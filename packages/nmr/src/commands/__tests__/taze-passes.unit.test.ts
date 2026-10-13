import { describe, expect, it } from 'vitest';

import { planTazePasses } from '../taze-passes.ts';

describe(planTazePasses, () => {
  it('returns the invocation as a single pass when the config declares no per-package period', () => {
    expect(planTazePasses(['--recursive'], undefined)).toStrictEqual([{ args: ['--recursive'] }]);
    expect(planTazePasses(['--recursive'], {})).toStrictEqual([{ args: ['--recursive'] }]);
  });

  it.each([
    ['--maturity-period', '7'],
    ['--maturity-period=7'],
    ['--maturityPeriod', '7'],
    ['--maturityPeriod=7'],
    ['--maturity-period'],
  ])('lets a command-line maturity period, given as %s, cover every dependency in one pass', (...flag: string[]) => {
    const args = ['--recursive', ...flag];

    expect(planTazePasses(args, { '@williamthorsen/*': 1 })).toStrictEqual([{ args }]);
  });

  it('still splits when a maturity period appears only after a bare --', () => {
    expect(planTazePasses(['--', '--maturity-period', '7'], { a: 1 })).toHaveLength(2);
  });

  it('runs one pass per entry, in declaration order, then one for every other dependency', () => {
    const passes = planTazePasses(['--recursive', '--write'], { '@williamthorsen/*': 1, readyup: 0.5 });

    expect(passes).toStrictEqual([
      {
        args: ['--recursive', '--write', '--maturity-period', '1', '--exclude', '/^(?!@williamthorsen/.*?$)/'],
        heading: 'Packages matching @williamthorsen/*: 1-day maturity period',
      },
      {
        args: [
          '--recursive',
          '--write',
          '--maturity-period',
          '0.5',
          '--exclude',
          '/^(?!readyup$)|^(?:@williamthorsen/.*?)$/',
        ],
        heading: 'Packages matching readyup: 0.5-day maturity period',
      },
      {
        args: ['--recursive', '--write', '--exclude', '@williamthorsen/*,readyup'],
        heading: 'All other packages: configured maturity period',
      },
    ]);
  });

  // taze passes everything past a bare `--` to a downstream tool, so a filter placed there would never apply.
  it('inserts its arguments ahead of a bare --', () => {
    const [entryPass, remainderPass] = planTazePasses(['major', '--', '--tail'], { a: 1 });

    expect(entryPass?.args).toStrictEqual([
      'major',
      '--maturity-period',
      '1',
      '--exclude',
      '/^(?!a$)/',
      '--',
      '--tail',
    ]);
    expect(remainderPass?.args).toStrictEqual(['major', '--exclude', 'a', '--', '--tail']);
  });

  describe('entry filters', () => {
    // Read each filter the way taze reads a `/body/flags` filter, so that these cases check what taze excludes.
    it('excludes exactly the packages that the key does not match', () => {
      const exclude = readEntryFilter({ '@williamthorsen/*': 1 }, 0);

      expect(exclude('@williamthorsen/nmr')).toBe(false);
      expect(exclude('@williamthorsen/')).toBe(false);
      expect(exclude('@williamthorsen-x/nmr')).toBe(true);
      expect(exclude('prefix@williamthorsen/nmr')).toBe(true);
      expect(exclude('typescript')).toBe(true);
    });

    it('treats regex metacharacters in a key literally', () => {
      const exclude = readEntryFilter({ 'lodash.merge': 1 }, 0);

      expect(exclude('lodash.merge')).toBe(false);
      expect(exclude('lodashxmerge')).toBe(true);
    });

    it('leaves a package to the first key that matches it', () => {
      const entries = { '@williamthorsen/nmr': 3, '@williamthorsen/*': 1 };

      expect(readEntryFilter(entries, 0)('@williamthorsen/nmr')).toBe(false);
      expect(readEntryFilter(entries, 1)('@williamthorsen/nmr')).toBe(true);
      expect(readEntryFilter(entries, 1)('@williamthorsen/nmr-core')).toBe(false);
    });
  });

  describe('validation', () => {
    it.each([['a list'], [['@williamthorsen/*']], [null], [7]])('rejects %j in place of a record', (value) => {
      expect(() => planTazePasses([], value)).toThrow('packageMaturityPeriod must be an object');
    });

    it('rejects a regex key, naming it', () => {
      expect(() => planTazePasses([], { '/^@acme\\//': 1 })).toThrow(String.raw`entry '/^@acme\//'`);
    });

    it('rejects a key containing a comma, which taze would split', () => {
      expect(() => planTazePasses([], { 'a,b': 1 })).toThrow("entry 'a,b': a key cannot contain a comma");
    });

    it.each([['typescript@7'], ['@williamthorsen/nmr@1']])('rejects the version selector %s, naming it', (key) => {
      expect(() => planTazePasses([], { [key]: 1 })).toThrow(
        `entry '${key}': a key names packages, not a version selector`,
      );
    });

    it('accepts a scoped key, whose only @ leads it', () => {
      expect(planTazePasses([], { '@williamthorsen/*': 1 })).toHaveLength(2);
    });

    it.each([[-1], [NaN], [Infinity], ['1']])('rejects the period %j', (days) => {
      expect(() => planTazePasses([], { a: days })).toThrow("entry 'a': the period must be a non-negative number");
    });

    it('accepts a period of 0, which disables the quarantine for the entry', () => {
      expect(planTazePasses([], { a: 0 })[0]?.args).toContain('0');
    });
  });
});

// region | Helpers

/** Returns a predicate reporting whether taze excludes a name under the filter of the entry pass at `index`. */
function readEntryFilter(entries: Record<string, number>, index: number): (name: string) => boolean {
  const args = planTazePasses([], entries)[index]?.args ?? [];
  const filter = args[args.indexOf('--exclude') + 1] ?? '';
  const end = filter.lastIndexOf('/');
  const regex = new RegExp(filter.slice(1, end), filter.slice(end + 1));
  return (name) => regex.test(name);
}

// endregion | Helpers
