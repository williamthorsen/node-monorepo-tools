import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isBuildInfo } from '../../contract/parse.ts';
import { collectBuildInfo } from '../collectBuildInfo.ts';
import { readGitFacts } from '../sources/readGitFacts.ts';

vi.mock(import('../sources/readGitFacts.ts'), () => ({ readGitFacts: vi.fn(() => ({})) }));

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const BARE_APP = path.join(FIXTURES_DIR, 'app-bare');
const JSON_APP = path.join(FIXTURES_DIR, 'app-with-changelog-json');
const MARKDOWN_APP = path.join(FIXTURES_DIR, 'app-with-changelog-md');

const NOW = new Date('2026-10-08T06:29:41.000Z');
const SHA = 'abc1234def5678abc1234def5678abc1234def56';
const OTHER_SHA = '9999999999999999999999999999999999999999';
const ACME_REPOSITORY = { provider: 'github', owner: 'acme', name: 'app', url: 'https://github.com/acme/app' };

const GIT_FACTS = {
  sha: SHA,
  ref: 'main',
  message: 'Add the widget',
  author: 'Ada Lovelace',
  time: '2026-10-08T06:00:00+00:00',
  dirty: false,
  remoteUrl: 'git@gitlab.com:acme/remote.git',
};

describe(collectBuildInfo, () => {
  afterEach(() => {
    vi.mocked(readGitFacts).mockReset().mockReturnValue({});
  });

  it('fills the commit, repository, and deployment from Vercel variables without git', () => {
    const info = collectBuildInfo({
      cwd: MARKDOWN_APP,
      now: NOW,
      env: {
        VERCEL: '1',
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_SHA: SHA,
        VERCEL_GIT_COMMIT_REF: 'main',
        VERCEL_GIT_COMMIT_MESSAGE: 'Add the widget',
        VERCEL_GIT_COMMIT_AUTHOR_LOGIN: 'ada',
        VERCEL_GIT_PROVIDER: 'github',
        VERCEL_GIT_REPO_OWNER: 'acme',
        VERCEL_GIT_REPO_SLUG: 'app',
        VERCEL_DEPLOYMENT_ID: 'dpl_123',
        VERCEL_URL: 'app-abc.vercel.app',
      },
    });

    expect(info).toStrictEqual({
      schemaVersion: 1,
      name: 'fixture-app',
      version: '0.7.0',
      buildTime: '2026-10-08T06:29:41.000Z',
      host: 'vercel',
      environment: 'production',
      commit: { sha: SHA, shortSha: 'abc1234', ref: 'main', message: 'Add the widget', author: 'ada' },
      repository: ACME_REPOSITORY,
      deployment: { id: 'dpl_123', url: 'https://app-abc.vercel.app' },
      runtime: { node: process.version },
      releaseNotes: { date: '2026-10-08', markdown: '### 🎉 Features\n\n- Adds the widget.' },
    });
    expect(isBuildInfo(info)).toBe(true);
  });

  it('adds git time and dirty state to an EAS commit, taking the repository from the manifest', () => {
    vi.mocked(readGitFacts).mockReturnValue({ ...GIT_FACTS, dirty: true });

    const info = collectBuildInfo({
      cwd: JSON_APP,
      now: NOW,
      env: { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'preview', EAS_BUILD_GIT_COMMIT_HASH: SHA, EAS_BUILD_ID: 'b-1' },
    });

    expect(info.host).toBe('eas');
    expect(info.environment).toBe('preview');
    expect(info.commit).toStrictEqual({ ...omitRemote(GIT_FACTS), shortSha: 'abc1234', dirty: true });
    expect(info.repository).toStrictEqual(ACME_REPOSITORY);
    expect(info.deployment).toStrictEqual({ id: 'b-1' });
    expect(info.releaseNotes?.sections?.map((section) => section.title)).toStrictEqual(['🎉 Features', '🐛 Bug fixes']);
    expect(isBuildInfo(info)).toBe(true);
  });

  it('reports a GitHub Actions push build', () => {
    vi.mocked(readGitFacts).mockReturnValue(GIT_FACTS);
    using tree = createTempTree(
      { 'event.json': JSON.stringify({ repository: { default_branch: 'main' } }) },
      { prefix: 'build-info-collect-' },
    );

    const info = collectBuildInfo({
      cwd: BARE_APP,
      now: NOW,
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: path.join(tree.dir, 'event.json'),
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: SHA,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/app',
        GITHUB_RUN_ID: '9876',
      },
    });

    expect(info.host).toBe('github-actions');
    expect(info.environment).toBe('production');
    expect(info.commit).toStrictEqual({ ...omitRemote(GIT_FACTS), shortSha: 'abc1234' });
    expect(info.repository).toStrictEqual(ACME_REPOSITORY);
    expect(info.deployment).toStrictEqual({ id: '9876' });
    expect(isBuildInfo(info)).toBe(true);
  });

  it('keeps only the host commit when git reports a different HEAD', () => {
    vi.mocked(readGitFacts).mockReturnValue({ ...GIT_FACTS, sha: OTHER_SHA, message: 'Merge abc into def' });

    const info = collectBuildInfo({
      cwd: BARE_APP,
      now: NOW,
      env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: SHA, GITHUB_REF_NAME: 'feature' },
    });

    expect(info.commit).toStrictEqual({ sha: SHA, shortSha: 'abc1234', ref: 'feature' });
  });

  it('omits the commit sha on a pull request whose payload does not name the head', () => {
    vi.mocked(readGitFacts).mockReturnValue({ ...GIT_FACTS, sha: OTHER_SHA, message: 'Merge abc into def' });

    const info = collectBuildInfo({
      cwd: BARE_APP,
      now: NOW,
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_SHA: OTHER_SHA,
        GITHUB_HEAD_REF: 'feature',
      },
    });

    expect(info.commit).toBeUndefined();
    expect(isBuildInfo(info)).toBe(true);
  });

  it('takes the commit from git and the repository from the git remote on a local build', () => {
    vi.mocked(readGitFacts).mockReturnValue(GIT_FACTS);

    const info = collectBuildInfo({ cwd: MARKDOWN_APP, now: NOW, env: { NODE_ENV: 'production' } });

    expect(info.host).toBe('local');
    expect(info.environment).toBe('production');
    expect(info.commit).toStrictEqual({ ...omitRemote(GIT_FACTS), shortSha: 'abc1234' });
    expect(info.repository).toStrictEqual({
      provider: 'gitlab',
      owner: 'acme',
      name: 'remote',
      url: 'https://gitlab.com/acme/remote',
    });
    expect(isBuildInfo(info)).toBe(true);
  });

  it('reports an unknown CI host', () => {
    const info = collectBuildInfo({ cwd: BARE_APP, now: NOW, env: { CI: 'true' } });

    expect(info.host).toBe('unknown');
    expect(isBuildInfo(info)).toBe(true);
  });

  it('omits the commit, repository, and release notes without git or a changelog', () => {
    expect(collectBuildInfo({ cwd: BARE_APP, now: NOW, env: {} })).toStrictEqual({
      schemaVersion: 1,
      name: 'fixture-app',
      version: '0.7.0',
      buildTime: '2026-10-08T06:29:41.000Z',
      host: 'local',
      environment: 'development',
      runtime: { node: process.version },
    });
  });

  it('does not run git when readGit is false', () => {
    vi.mocked(readGitFacts).mockReturnValue(GIT_FACTS);

    const info = collectBuildInfo({ cwd: BARE_APP, env: {}, readGit: false });

    expect(readGitFacts).not.toHaveBeenCalled();
    expect(info.commit).toBeUndefined();
  });

  it('defaults the build time to the time of the call', () => {
    vi.useFakeTimers({ now: NOW });
    try {
      expect(collectBuildInfo({ cwd: BARE_APP, env: {} }).buildTime).toBe('2026-10-08T06:29:41.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});

// region | Helpers

/** Returns the git facts without the remote, which the commit does not report. */
function omitRemote({ remoteUrl: _remoteUrl, ...facts }: typeof GIT_FACTS): Omit<typeof GIT_FACTS, 'remoteUrl'> {
  return facts;
}

// endregion | Helpers
