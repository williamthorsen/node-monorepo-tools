import { describe, expect, it } from 'vitest';

import { readHostFacts } from '../readHostFacts.ts';

describe(readHostFacts, () => {
  it('prefers Vercel, then EAS Build, then GitHub Actions', () => {
    const env = { VERCEL: '1', EAS_BUILD: 'true', GITHUB_ACTIONS: 'true' };

    expect(readHostFacts(env).host).toBe('vercel');
    expect(readHostFacts({ ...env, VERCEL: '' }).host).toBe('eas');
    expect(readHostFacts({ ...env, VERCEL: '', EAS_BUILD: '' }).host).toBe('github-actions');
  });

  it.each([
    [{}, 'local'],
    [{ CI: '' }, 'local'],
    [{ CI: 'false' }, 'local'],
    [{ CI: 'true' }, 'unknown'],
    [{ CI: '1' }, 'unknown'],
  ])('falls back to the CI-dependent host for %j', (env, host) => {
    expect(readHostFacts(env)).toStrictEqual({ host, environment: 'development' });
  });

  it('takes the fallback environment from NODE_ENV', () => {
    expect(readHostFacts({ NODE_ENV: 'test' }).environment).toBe('test');
  });

  it("falls back to NODE_ENV, else development, when a host's environment variables are empty", () => {
    expect(
      readHostFacts({ VERCEL: '1', VERCEL_TARGET_ENV: '', VERCEL_ENV: '', NODE_ENV: 'production' }).environment,
    ).toBe('production');
    expect(readHostFacts({ EAS_BUILD: 'true' }).environment).toBe('development');
  });

  it("keeps the host's own environment", () => {
    expect(readHostFacts({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'preview', NODE_ENV: 'production' }).environment).toBe(
      'preview',
    );
  });
});
