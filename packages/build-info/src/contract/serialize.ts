import { normalizeBuildInfo } from './normalize.ts';
import type { BuildInfo } from './types.ts';

/**
 * Serializes a `BuildInfo` as JSON indented by two spaces, without a trailing newline. The output contains only the
 * contract's keys, in the contract's order, so that `parseBuildInfo` accepts every file written from it.
 *
 * @throws {InvalidBuildInfoError} naming the first field that breaks the contract.
 */
export function serializeBuildInfo(info: BuildInfo): string {
  return JSON.stringify(normalizeBuildInfo(info), null, 2);
}
