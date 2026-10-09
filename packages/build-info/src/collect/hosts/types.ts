import type { BuildInfo } from '../../contract/types.ts';

/** The environment variables that a host reader inspects. */
export type HostEnv = Readonly<Record<string, string | undefined>>;

/** What a build host reports about a build; a field that the host does not expose is absent. */
export interface HostFacts {
  host: BuildInfo['host'];
  environment?: BuildInfo['environment'];
  commit?: Partial<Pick<NonNullable<BuildInfo['commit']>, 'author' | 'message' | 'ref' | 'sha'>>;
  repository?: BuildInfo['repository'];
  deployment?: BuildInfo['deployment'];
  /** Whether git's `HEAD` is known not to be the build's commit, so that git must not supply any commit field. */
  excludesGitCommit?: true;
}
