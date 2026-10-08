import { describe, expect, it } from 'vitest';

import { parseRepositoryUrl } from '../parseRepositoryUrl.ts';

const GITHUB_REPOSITORY = {
  provider: 'github',
  owner: 'acme',
  name: 'app',
  url: 'https://github.com/acme/app',
};

describe(parseRepositoryUrl, () => {
  it.each([
    'acme/app',
    'github:acme/app',
    'https://github.com/acme/app',
    'https://github.com/acme/app.git',
    'git+https://github.com/acme/app.git',
    'git://github.com/acme/app.git',
    'ssh://git@github.com/acme/app.git',
    'git@github.com:acme/app.git',
  ])('parses %s', (value) => {
    expect(parseRepositoryUrl(value)).toStrictEqual(GITHUB_REPOSITORY);
  });

  it('reads the url of an object, ignoring its directory', () => {
    const repository = { type: 'git', url: 'git+https://github.com/acme/app.git', directory: 'apps/web' };

    expect(parseRepositoryUrl(repository)).toStrictEqual(GITHUB_REPOSITORY);
  });

  it('maps the shorthand providers to their hosts', () => {
    expect(parseRepositoryUrl('gitlab:acme/app')).toStrictEqual({
      provider: 'gitlab',
      owner: 'acme',
      name: 'app',
      url: 'https://gitlab.com/acme/app',
    });
    expect(parseRepositoryUrl('bitbucket:acme/app')?.url).toBe('https://bitbucket.org/acme/app');
  });

  it('keeps nested groups in the owner', () => {
    expect(parseRepositoryUrl('https://gitlab.com/acme/platform/app.git')).toStrictEqual({
      provider: 'gitlab',
      owner: 'acme/platform',
      name: 'app',
      url: 'https://gitlab.com/acme/platform/app',
    });
  });

  it('names an unknown host as its own provider', () => {
    expect(parseRepositoryUrl('git@git.example.com:acme/app.git')).toStrictEqual({
      provider: 'git.example.com',
      owner: 'acme',
      name: 'app',
      url: 'https://git.example.com/acme/app',
    });
  });

  it.each([undefined, 42, '', 'app', 'https://github.com/app', './local/path', { type: 'git' }])(
    'returns undefined for %o',
    (value) => {
      expect(parseRepositoryUrl(value)).toBeUndefined();
    },
  );
});
