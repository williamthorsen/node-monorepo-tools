import { compactRecord } from '../portable/compactRecord.ts';
import { parseRepositoryUrl } from '../sources/parseRepositoryUrl.ts';
import { parsePullRequestNumber } from './parsePullRequestNumber.ts';
import { readEnv } from './readEnv.ts';
import type { HostEnv, HostFacts } from './types.ts';

/** Reports the facts of a Vercel build, or `undefined` when `env` is not one. */
export function readVercelFacts(env: HostEnv): HostFacts | undefined {
  if (readEnv(env, 'VERCEL') !== '1') {
    return undefined;
  }

  const vercelUrl = readEnv(env, 'VERCEL_URL');
  return {
    host: 'vercel',
    ...compactRecord<Omit<HostFacts, 'host'>>({
      environment: readEnv(env, 'VERCEL_TARGET_ENV') ?? readEnv(env, 'VERCEL_ENV'),
      commit: compactRecord<NonNullable<HostFacts['commit']>>({
        sha: readEnv(env, 'VERCEL_GIT_COMMIT_SHA'),
        ref: readEnv(env, 'VERCEL_GIT_COMMIT_REF'),
        message: readEnv(env, 'VERCEL_GIT_COMMIT_MESSAGE')?.split('\n', 1)[0],
        author: readEnv(env, 'VERCEL_GIT_COMMIT_AUTHOR_NAME') ?? readEnv(env, 'VERCEL_GIT_COMMIT_AUTHOR_LOGIN'),
      }),
      repository: readRepository(env),
      deployment: compactRecord<NonNullable<HostFacts['deployment']>>({
        id: readEnv(env, 'VERCEL_DEPLOYMENT_ID'),
        url: vercelUrl === undefined ? undefined : `https://${vercelUrl}`,
        pullRequest: parsePullRequestNumber(readEnv(env, 'VERCEL_GIT_PULL_REQUEST_ID')),
      }),
    }),
  };
}

// region | Helpers

/** Reads the repository from Vercel's provider, owner, and slug, through the parser's `provider:owner/name` form. */
function readRepository(env: HostEnv): HostFacts['repository'] {
  const provider = readEnv(env, 'VERCEL_GIT_PROVIDER');
  const owner = readEnv(env, 'VERCEL_GIT_REPO_OWNER');
  const slug = readEnv(env, 'VERCEL_GIT_REPO_SLUG');
  if (provider === undefined || owner === undefined || slug === undefined) {
    return undefined;
  }
  return parseRepositoryUrl(`${provider}:${owner}/${slug}`);
}

// endregion | Helpers
