import { readFileSync } from 'node:fs';

import { compactRecord } from '../portable/compactRecord.ts';
import { parsePullRequestNumber } from './parsePullRequestNumber.ts';
import { readEnv } from './readEnv.ts';
import type { HostEnv, HostFacts } from './types.ts';

const PULL_REQUEST_EVENTS: ReadonlySet<string> = new Set(['pull_request', 'pull_request_target']);

/**
 * Reports the facts of a GitHub Actions build, or `undefined` when `env` is not one. On a pull-request event the commit
 * is the pull request's head, because `GITHUB_SHA` there names a synthetic merge commit. The environment is
 * `production` on a push to the default branch, which only the event payload names, and `preview` otherwise.
 */
export function readGithubActionsFacts(env: HostEnv): HostFacts | undefined {
  if (readEnv(env, 'GITHUB_ACTIONS') !== 'true') {
    return undefined;
  }

  const event = readEventPayload(readEnv(env, 'GITHUB_EVENT_PATH'));
  const eventName = readEnv(env, 'GITHUB_EVENT_NAME');
  const pullRequest =
    eventName !== undefined && PULL_REQUEST_EVENTS.has(eventName) ? readPullRequest(event) : undefined;
  const ref = readEnv(env, pullRequest === undefined ? 'GITHUB_REF_NAME' : 'GITHUB_HEAD_REF');
  const defaultBranch = readString(readRecord(event, 'repository'), 'default_branch');

  return {
    host: 'github-actions',
    environment: pullRequest === undefined && ref !== undefined && ref === defaultBranch ? 'production' : 'preview',
    ...compactRecord<Omit<HostFacts, 'environment' | 'host'>>({
      commit: compactRecord<NonNullable<HostFacts['commit']>>({
        sha: pullRequest === undefined ? readEnv(env, 'GITHUB_SHA') : pullRequest.headSha,
        ref,
      }),
      repository: readRepository(env),
      deployment: compactRecord<NonNullable<HostFacts['deployment']>>({
        id: readEnv(env, 'GITHUB_RUN_ID'),
        pullRequest: pullRequest?.number,
      }),
    }),
  };
}

// region | Helpers

/** Reports whether a value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the event payload as an object, or `undefined` when the file is missing or does not hold a JSON object. */
function readEventPayload(eventPath: string | undefined): Record<string, unknown> | undefined {
  if (eventPath === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(eventPath, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the head sha and number of the payload's pull request. A pull-request event yields a result even when the
 * payload is unreadable, so that the merge commit in `GITHUB_SHA` is never reported in place of the head.
 */
function readPullRequest(event: Record<string, unknown> | undefined): { headSha?: string; number?: number } {
  const pullRequest = readRecord(event, 'pull_request');
  return {
    ...compactRecord<{ headSha: string; number: number }>({
      headSha: readString(readRecord(pullRequest, 'head'), 'sha'),
      number: parsePullRequestNumber(pullRequest?.['number']),
    }),
  };
}

/** Returns the property of a record when it is itself a record. */
function readRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

/** Reads the repository from `GITHUB_SERVER_URL` and the `owner/name` in `GITHUB_REPOSITORY`. */
function readRepository(env: HostEnv): HostFacts['repository'] {
  const serverUrl = readEnv(env, 'GITHUB_SERVER_URL')?.replace(/\/+$/, '');
  const [owner, name, ...rest] = readEnv(env, 'GITHUB_REPOSITORY')?.split('/') ?? [];
  if (serverUrl === undefined || owner === undefined || name === undefined || rest.length > 0) {
    return undefined;
  }
  return { provider: 'github', owner, name, url: `${serverUrl}/${owner}/${name}` };
}

/** Returns the property of a record when it is a non-empty string. */
function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// endregion | Helpers
