import { describe, expect, it } from 'vitest';

import { DELEGATE_ENV_VAR, deriveCheckoutPath, resolveDelegationTarget, wrapRemoteScript } from '../remote-run.ts';

describe(resolveDelegationTarget, () => {
  it.for([
    { case: 'nothing asks for it', expected: { kind: 'local' } },
    { case: 'the flag names a host', flagHost: 'box', expected: { kind: 'remote', host: 'box', source: 'flag' } },
    { case: 'the variable names a host', envHost: 'box', expected: { kind: 'remote', host: 'box', source: 'env' } },
    { case: 'the variable is empty', envHost: '', expected: { kind: 'local' } },
    {
      case: 'the flag and the variable disagree',
      envHost: 'other',
      flagHost: 'box',
      expected: { kind: 'remote', host: 'box', source: 'flag' },
    },
    { case: '--no-delegate overrides the flag', flagHost: 'box', isOptedOut: true, expected: { kind: 'local' } },
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
      expected: { kind: 'remote', host: 'box', source: 'env' },
    },
  ])(
    'resolves $expected.kind when $case',
    ({ command = 'ci', envHost, expected, flagHost, isOptedOut = false, isReading = false }) => {
      const env = envHost === undefined ? {} : { [DELEGATE_ENV_VAR]: envHost };

      expect(resolveDelegationTarget({ command, env, flagHost, isOptedOut, isReading })).toStrictEqual(expected);
    },
  );

  it.for(['build', 'clean', 'compile', 'fix', 'fmt', 'lint', 'test:watch', 'upgrade', 'root:fmt', 'root:test:watch'])(
    'refuses `%s` under the flag',
    (command) => {
      const target = resolveDelegationTarget({
        command,
        env: {},
        flagHost: 'box',
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
      flagHost: 'box',
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
