import { readEasFacts } from './readEasFacts.ts';
import { readEnv } from './readEnv.ts';
import { readGithubActionsFacts } from './readGithubActionsFacts.ts';
import { readVercelFacts } from './readVercelFacts.ts';
import type { HostEnv, HostFacts } from './types.ts';

/**
 * Reports the facts of the first host that `env` identifies, in the order Vercel, EAS Build, GitHub Actions. Any other
 * build is `unknown` when `CI` is set and `local` otherwise. An environment that the host leaves empty falls back to
 * `NODE_ENV`, else `development`.
 */
export function readHostFacts(env: HostEnv): HostFacts & { environment: string } {
  const facts = readVercelFacts(env) ??
    readEasFacts(env) ??
    readGithubActionsFacts(env) ?? { host: isCiSet(env) ? 'unknown' : 'local' };
  return { ...facts, environment: facts.environment ?? readEnv(env, 'NODE_ENV') ?? 'development' };
}

// region | Helpers

/** Reports whether `CI` is set to a value other than `false`. */
function isCiSet(env: HostEnv): boolean {
  const ci = readEnv(env, 'CI');
  return ci !== undefined && ci !== 'false';
}

// endregion | Helpers
