import { describe, expect, it } from 'vitest';

import { insertBeforeTerminator, isSilent, readFlag } from '../taze-args.ts';

describe(insertBeforeTerminator, () => {
  it('appends when the arguments do not contain a bare --', () => {
    expect(insertBeforeTerminator(['a'], ['b'])).toStrictEqual(['a', 'b']);
  });

  it('inserts ahead of the first bare --', () => {
    expect(insertBeforeTerminator(['a', '--', 'c', '--'], ['b'])).toStrictEqual(['a', 'b', '--', 'c', '--']);
  });
});

describe(isSilent, () => {
  it.each([[['--silent']], [['-s']], [['--loglevel', 'silent']], [['--loglevel=silent']]])(
    'reports %j as silent',
    (args) => {
      expect(isSilent(args)).toBe(true);
    },
  );

  it.each([[[]], [['--loglevel', 'warn']], [['--', '--silent']]])('reports %j as not silent', (args) => {
    expect(isSilent(args)).toBe(false);
  });
});

describe(readFlag, () => {
  it('reads the value that follows the flag', () => {
    expect(readFlag(['-C', 'packages/a'], ['--cwd', '-C'])).toStrictEqual({ value: 'packages/a' });
  });

  it('reads the value of the =value form', () => {
    expect(readFlag(['--cwd=packages/a'], ['--cwd', '-C'])).toStrictEqual({ value: 'packages/a' });
  });

  it('reports a flag without a value when the next argument is another flag or absent', () => {
    expect(readFlag(['--maturity-period', '--write'], ['--maturity-period'])).toStrictEqual({ value: undefined });
    expect(readFlag(['--maturity-period'], ['--maturity-period'])).toStrictEqual({ value: undefined });
  });

  it('does not match a longer flag that shares the prefix', () => {
    expect(readFlag(['--cwdx'], ['--cwd'])).toBeUndefined();
  });

  it('ignores everything past a bare --', () => {
    expect(readFlag(['--', '--cwd', 'x'], ['--cwd'])).toBeUndefined();
  });
});
