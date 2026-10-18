import { describe, expect, it } from 'vitest';

import { DELEGATE_ENV_VAR, deriveCheckoutPath, resolveDelegationTarget, wrapRemoteScript } from '../remote-run.ts';

describe(resolveDelegationTarget, () => {
  it.for([
    { case: 'nothing asks for it', expected: { kind: 'local' } },
    { case: 'the flag names a host', flagValue: 'box', expected: { kind: 'remote', hosts: ['box'], source: 'flag' } },
    { case: 'the variable names a host', envHost: 'box', expected: { kind: 'remote', hosts: ['box'], source: 'env' } },
    { case: 'the variable is empty', envHost: '', expected: { kind: 'local' } },
    {
      case: 'the flag and the variable disagree',
      envHost: 'other',
      flagValue: 'box',
      expected: { kind: 'remote', hosts: ['box'], source: 'flag' },
    },
    { case: '--no-delegate overrides the flag', flagValue: 'box', isOptedOut: true, expected: { kind: 'local' } },
    { case: '--no-delegate overrides the variable', envHost: 'box', isOptedOut: true, expected: { kind: 'local' } },
    {
      case: 'the variable meets a tree-rewriting command',
      command: 'fmt',
      envHost: 'box',
      expected: { kind: 'local' },
    },
    { case: 'the variable meets --log', envHost: 'box', isReading: true, expected: { kind: 'local' } },
    {
      case: 'the variable meets a custom script',
      command: 'test:e2e',
      envHost: 'box',
      expected: { kind: 'remote', hosts: ['box'], source: 'env' },
    },
  ])(
    'resolves $expected.kind when $case',
    ({ command = 'ci', envHost, expected, flagValue, isOptedOut = false, isReading = false }) => {
      const env = envHost === undefined ? {} : { [DELEGATE_ENV_VAR]: envHost };

      expect(resolveDelegationTarget({ command, env, flagValue, isOptedOut, isReading })).toStrictEqual(expected);
    },
  );

  it.for([
    { case: 'the flag', flagValue: 'box,spare', expected: { kind: 'remote', hosts: ['box', 'spare'], source: 'flag' } },
    {
      case: 'the variable',
      envValue: 'box,spare',
      expected: { kind: 'remote', hosts: ['box', 'spare'], source: 'env' },
    },
    {
      case: 'a list with whitespace, empty entries, and repeats',
      flagValue: ' box , ,spare,box,',
      expected: { kind: 'remote', hosts: ['box', 'spare'], source: 'flag' },
    },
    { case: 'a variable that does not name a host', envValue: ' , ', expected: { kind: 'local' } },
  ])('reads a host list from $case', ({ envValue, expected, flagValue }) => {
    const env = envValue === undefined ? {} : { [DELEGATE_ENV_VAR]: envValue };

    expect(
      resolveDelegationTarget({ command: 'ci', env, flagValue, isOptedOut: false, isReading: false }),
    ).toStrictEqual(expected);
  });

  it('refuses a flag value that does not name a host', () => {
    const target = resolveDelegationTarget({
      command: 'ci',
      env: {},
      flagValue: ' , ',
      isOptedOut: false,
      isReading: false,
    });

    expect(target).toStrictEqual({ kind: 'refused', error: expect.stringContaining('does not name a host') });
  });

  it.for(['build', 'clean', 'compile', 'fix', 'fmt', 'lint', 'test:watch', 'upgrade', 'root:fmt', 'root:test:watch'])(
    'refuses `%s` under the flag',
    (command) => {
      const target = resolveDelegationTarget({
        command,
        env: {},
        flagValue: 'box',
        isOptedOut: false,
        isReading: false,
      });

      expect(target).toStrictEqual({
        kind: 'refused',
        error: expect.stringContaining(`\`${command}\` cannot be delegated`),
      });
    },
  );

  it('refuses --log under the flag', () => {
    const target = resolveDelegationTarget({
      command: 'test',
      env: {},
      flagValue: 'box',
      isOptedOut: false,
      isReading: true,
    });

    expect(target).toStrictEqual({ kind: 'refused', error: expect.stringContaining('--log cannot be delegated') });
  });
});

describe(deriveCheckoutPath, () => {
  it('keys the checkout by machine and repository and ends with the repository name', () => {
    const checkoutPath = deriveCheckoutPath('laptop', '/repos/tools');

    expect(checkoutPath).toMatch(/^\.cache\/nmr\/delegate\/[\da-f]{16}\/tools$/);
    expect(deriveCheckoutPath('laptop', '/repos/tools')).toBe(checkoutPath);
    expect(deriveCheckoutPath('desktop', '/repos/tools')).not.toBe(checkoutPath);
    expect(deriveCheckoutPath('laptop', '/repos/tools.worktree/tools')).not.toBe(checkoutPath);
  });
});

describe(wrapRemoteScript, () => {
  it('runs the script under /bin/sh with the PATH of the interactive login shell', () => {
    const wrapped = wrapRemoteScript('echo hi');

    expect(wrapped).toMatch(/^exec \/bin\/sh -c '/);
    expect(wrapped).toContain('-ilc');
    expect(wrapped).toContain('echo hi');
  });
});
