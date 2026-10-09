import { describe, expect, it } from 'vitest';

import { readVercelFacts } from '../readVercelFacts.ts';

const VERCEL_ENV = {
  VERCEL: '1',
  VERCEL_TARGET_ENV: 'staging',
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_SHA: 'abc1234def',
  VERCEL_GIT_COMMIT_REF: 'feature',
  VERCEL_GIT_COMMIT_MESSAGE: 'Add the widget\n\nWith a body.',
  VERCEL_GIT_COMMIT_AUTHOR_NAME: 'Ada Lovelace',
  VERCEL_GIT_COMMIT_AUTHOR_LOGIN: 'ada',
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'acme',
  VERCEL_GIT_REPO_SLUG: 'app',
  VERCEL_DEPLOYMENT_ID: 'dpl_123',
  VERCEL_URL: 'app-abc.vercel.app',
  VERCEL_GIT_PULL_REQUEST_ID: '42',
};

describe(readVercelFacts, () => {
  it('returns undefined outside Vercel', () => {
    expect(readVercelFacts({})).toBeUndefined();
    expect(readVercelFacts({ VERCEL: '' })).toBeUndefined();
  });

  it('maps every Vercel variable', () => {
    expect(readVercelFacts(VERCEL_ENV)).toStrictEqual({
      host: 'vercel',
      environment: 'staging',
      commit: { sha: 'abc1234def', ref: 'feature', message: 'Add the widget', author: 'Ada Lovelace' },
      repository: { provider: 'github', owner: 'acme', name: 'app', url: 'https://github.com/acme/app' },
      deployment: { id: 'dpl_123', url: 'https://app-abc.vercel.app', pullRequest: 42 },
    });
  });

  it('falls back to VERCEL_ENV and the author login', () => {
    const facts = readVercelFacts({
      ...VERCEL_ENV,
      VERCEL_TARGET_ENV: '',
      VERCEL_GIT_COMMIT_AUTHOR_NAME: '',
    });

    expect(facts?.environment).toBe('preview');
    expect(facts?.commit?.author).toBe('ada');
  });

  it.each([
    ['gitlab', 'https://gitlab.com/acme/app'],
    ['bitbucket', 'https://bitbucket.org/acme/app'],
  ])('maps the %s provider to its host', (provider, url) => {
    expect(readVercelFacts({ ...VERCEL_ENV, VERCEL_GIT_PROVIDER: provider })?.repository).toStrictEqual({
      provider,
      owner: 'acme',
      name: 'app',
      url,
    });
  });

  it('omits the repository for an unrecognized provider', () => {
    expect(readVercelFacts({ ...VERCEL_ENV, VERCEL_GIT_PROVIDER: 'gitea' })?.repository).toBeUndefined();
  });

  it('omits every field whose variables are empty', () => {
    expect(readVercelFacts({ VERCEL: '1', VERCEL_ENV: '', VERCEL_GIT_PULL_REQUEST_ID: '' })).toStrictEqual({
      host: 'vercel',
    });
  });
});
