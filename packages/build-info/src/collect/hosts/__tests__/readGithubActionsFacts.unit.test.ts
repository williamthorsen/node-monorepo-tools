import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it } from 'vitest';

import { readGithubActionsFacts } from '../readGithubActionsFacts.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const HEAD_SHA = '2222222222222222222222222222222222222222';
const MERGE_SHA = '3333333333333333333333333333333333333333';
const PUSH_SHA = '1111111111111111111111111111111111111111';

const GITHUB_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_EVENT_PATH: path.join(FIXTURES_DIR, 'push-event.json'),
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: PUSH_SHA,
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_RUN_ID: '9876',
};

const PULL_REQUEST_ENV = {
  ...GITHUB_ENV,
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_EVENT_PATH: path.join(FIXTURES_DIR, 'pull-request-event.json'),
  GITHUB_REF_NAME: '42/merge',
  GITHUB_HEAD_REF: 'feature',
  GITHUB_SHA: MERGE_SHA,
};

const REPOSITORY = { provider: 'github', owner: 'acme', name: 'app', url: 'https://github.com/acme/app' };

describe(readGithubActionsFacts, () => {
  it('returns undefined outside GitHub Actions', () => {
    expect(readGithubActionsFacts({})).toBeUndefined();
  });

  it('reports production for a push to the default branch', () => {
    expect(readGithubActionsFacts(GITHUB_ENV)).toStrictEqual({
      host: 'github-actions',
      environment: 'production',
      commit: { sha: PUSH_SHA, ref: 'main' },
      repository: REPOSITORY,
      deployment: { id: '9876' },
    });
  });

  it('reports preview for a push to another branch', () => {
    const facts = readGithubActionsFacts({ ...GITHUB_ENV, GITHUB_REF_NAME: 'feature' });

    expect(facts?.environment).toBe('preview');
    expect(facts?.commit?.ref).toBe('feature');
  });

  it.each(['pull_request', 'pull_request_target'])(
    'reports the head commit and pull request number on a %s event',
    (eventName) => {
      expect(readGithubActionsFacts({ ...PULL_REQUEST_ENV, GITHUB_EVENT_NAME: eventName })).toStrictEqual({
        host: 'github-actions',
        environment: 'preview',
        commit: { sha: HEAD_SHA, ref: 'feature' },
        repository: REPOSITORY,
        deployment: { id: '9876', pullRequest: 42 },
      });
    },
  );

  it('reports preview on a pull request whose head is the default branch', () => {
    expect(readGithubActionsFacts({ ...PULL_REQUEST_ENV, GITHUB_HEAD_REF: 'main' })?.environment).toBe('preview');
  });

  it('reports preview when the event payload is missing', () => {
    const facts = readGithubActionsFacts({ ...GITHUB_ENV, GITHUB_EVENT_PATH: path.join(FIXTURES_DIR, 'absent.json') });

    expect(facts?.environment).toBe('preview');
    expect(facts?.commit).toStrictEqual({ sha: PUSH_SHA, ref: 'main' });
  });

  it('reports preview when the event payload is malformed', () => {
    using tree = createTempTree({ 'event.json': '{ "repository":' }, { prefix: 'build-info-github-event-' });
    const facts = readGithubActionsFacts({ ...GITHUB_ENV, GITHUB_EVENT_PATH: path.join(tree.dir, 'event.json') });

    expect(facts?.environment).toBe('preview');
    expect(facts?.commit).toStrictEqual({ sha: PUSH_SHA, ref: 'main' });
  });

  it('omits the merge commit on a pull request whose payload is unreadable', () => {
    const facts = readGithubActionsFacts({ ...PULL_REQUEST_ENV, GITHUB_EVENT_PATH: '' });

    expect(facts?.commit).toStrictEqual({ ref: 'feature' });
    expect(facts?.deployment).toStrictEqual({ id: '9876' });
    expect(facts?.excludesGitCommit).toBe(true);
  });

  it('builds the repository URL from a custom server', () => {
    expect(
      readGithubActionsFacts({ ...GITHUB_ENV, GITHUB_SERVER_URL: 'https://github.example.com/' })?.repository,
    ).toStrictEqual({ provider: 'github', owner: 'acme', name: 'app', url: 'https://github.example.com/acme/app' });
  });

  it.each(['', 'acme', 'acme/app/extra'])('omits the repository when GITHUB_REPOSITORY is %j', (repository) => {
    expect(readGithubActionsFacts({ ...GITHUB_ENV, GITHUB_REPOSITORY: repository })?.repository).toBeUndefined();
  });
});
