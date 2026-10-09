import type { BuildInfo } from '../../contract/types.ts';

const PROVIDER_BY_HOST: Readonly<Record<string, string>> = {
  'bitbucket.org': 'bitbucket',
  'github.com': 'github',
  'gitlab.com': 'gitlab',
};

/** Hosts named by npm's `provider:owner/name` shorthand. */
const HOST_BY_SHORTHAND: Readonly<Record<string, string>> = {
  bitbucket: 'bitbucket.org',
  github: 'github.com',
  gitlab: 'gitlab.com',
};

/**
 * Parses a manifest `repository` (a string or an object with a `url`) or a git remote URL into the repository that it
 * names, or `undefined` when the value is not in a recognized form.
 */
export function parseRepositoryUrl(value: unknown): BuildInfo['repository'] {
  const candidate = typeof value === 'object' && value !== null && 'url' in value ? value.url : value;
  if (typeof candidate !== 'string') {
    return undefined;
  }

  const location = parseShorthand(candidate.trim()) ?? parseUrl(candidate.trim());
  if (location === undefined) {
    return undefined;
  }
  return buildRepository(location.host, location.repoPath);
}

/** Returns the provider that a host serves: a known provider's name, else the hostname itself. */
export function resolveProvider(host: string): string {
  return PROVIDER_BY_HOST[host] ?? host;
}

// region | Helpers

/** Builds the repository from a host and an `owner/name` path, the owner taking every segment before the last. */
function buildRepository(host: string, repoPath: string): BuildInfo['repository'] {
  const segments = repoPath
    .replace(/\.git$/, '')
    .split('/')
    .filter((segment) => segment.length > 0);
  const name = segments.pop();
  if (name === undefined || segments.length === 0) {
    return undefined;
  }
  const owner = segments.join('/');
  return { provider: resolveProvider(host), owner, name, url: `https://${host}/${owner}/${name}` };
}

/** Parses npm's `provider:owner/name` and bare `owner/name` shorthands. */
function parseShorthand(value: string): { host: string; repoPath: string } | undefined {
  const match = /^(?:(bitbucket|github|gitlab):)?(\w[\w.-]*\/[\w.-]+)$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const host = HOST_BY_SHORTHAND[match[1] ?? 'github'];
  const repoPath = match[2];
  return host === undefined || repoPath === undefined ? undefined : { host, repoPath };
}

/** Parses a URL form: `https://`, `git+https://`, `git://`, `ssh://`, or scp-like `git@host:owner/name.git`. */
function parseUrl(value: string): { host: string; repoPath: string } | undefined {
  const scpLike = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(value);
  if (scpLike?.[1] !== undefined && scpLike[2] !== undefined) {
    return { host: scpLike[1], repoPath: scpLike[2] };
  }

  try {
    const url = new URL(value.replace(/^git\+/, ''));
    return url.hostname.length > 0 ? { host: url.hostname, repoPath: url.pathname } : undefined;
  } catch {
    return undefined;
  }
}

// endregion | Helpers
