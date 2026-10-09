import { compactRecord } from '../portable/compactRecord.ts';
import { readEnv } from './readEnv.ts';
import type { HostEnv, HostFacts } from './types.ts';

/** Reports the facts of an EAS build, or `undefined` when `env` is not one. */
export function readEasFacts(env: HostEnv): HostFacts | undefined {
  if (readEnv(env, 'EAS_BUILD') !== 'true') {
    return undefined;
  }

  return {
    host: 'eas',
    ...compactRecord<Omit<HostFacts, 'host'>>({
      environment: readEnv(env, 'EAS_BUILD_PROFILE'),
      commit: compactRecord<NonNullable<HostFacts['commit']>>({ sha: readEnv(env, 'EAS_BUILD_GIT_COMMIT_HASH') }),
      deployment: compactRecord<NonNullable<HostFacts['deployment']>>({ id: readEnv(env, 'EAS_BUILD_ID') }),
    }),
  };
}
