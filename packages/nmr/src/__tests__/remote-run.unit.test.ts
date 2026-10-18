import { describe, expect, it } from 'vitest';

import { deriveCheckoutPath, wrapRemoteScript } from '../remote-run.ts';

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
