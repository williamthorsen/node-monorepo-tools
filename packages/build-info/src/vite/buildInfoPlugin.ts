import type { Plugin } from 'vite';

import { collectBuildInfo, type CollectBuildInfoOptions } from '../collect/collectBuildInfo.ts';
import { serializeBuildInfo } from '../contract/serialize.ts';

/**
 * Creates a Vite plugin that collects the build's `BuildInfo` once, defines `__BUILD_INFO__` as that object, and emits
 * it as `build-info.json` in the output directory.
 */
export function buildInfoPlugin(options?: CollectBuildInfoOptions): Plugin {
  let serialized: string | undefined;

  return {
    name: 'build-info',
    config() {
      serialized = serializeBuildInfo(collectBuildInfo(options));
      return { define: { __BUILD_INFO__: serialized } };
    },
    generateBundle() {
      if (serialized !== undefined) {
        // eslint-disable-next-line unicorn/no-this-outside-of-class -- Rolldown passes the plugin context only as `this`.
        this.emitFile({ type: 'asset', fileName: 'build-info.json', source: serialized });
      }
    },
  };
}
