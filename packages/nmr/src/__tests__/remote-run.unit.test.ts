import { describe, expect, it } from 'vitest';

import {
  composeGitSshCommand,
  composeSshArgv,
  deriveCheckoutPath,
  SSH_COMMAND_ENV_VAR,
  SSH_OPTIONS,
  wrapRemoteScript,
} from '../remote-run.ts';

const WRAPPER_COMMAND = `'/opt/my ssh' -o ProxyCommand="nc %h %p"`;

describe(composeGitSshCommand, () => {
  it("appends nmr's options to the environment's ssh command", () => {
    expect(composeGitSshCommand({ [SSH_COMMAND_ENV_VAR]: WRAPPER_COMMAND })).toBe(
      [WRAPPER_COMMAND, ...SSH_OPTIONS].join(' '),
    );
  });

  it.each([{ [SSH_COMMAND_ENV_VAR]: '' }, {}])('falls back to plain ssh for %o', (env) => {
    expect(composeGitSshCommand(env)).toBe(['ssh', ...SSH_OPTIONS].join(' '));
  });
});

describe(composeSshArgv, () => {
  it("runs the environment's ssh command under /bin/sh with nmr's options, the host, and the command as arguments", () => {
    expect(composeSshArgv({ [SSH_COMMAND_ENV_VAR]: WRAPPER_COMMAND }, 'imac2', 'true')).toStrictEqual([
      '/bin/sh',
      '-c',
      `${WRAPPER_COMMAND} "$@"`,
      WRAPPER_COMMAND,
      ...SSH_OPTIONS,
      'imac2',
      'true',
    ]);
  });

  it.each([{ [SSH_COMMAND_ENV_VAR]: '' }, {}])('runs plain ssh for %o', (env) => {
    expect(composeSshArgv(env, 'imac2', 'true')).toStrictEqual(['ssh', ...SSH_OPTIONS, 'imac2', 'true']);
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
