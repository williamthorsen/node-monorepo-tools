import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BuildConfig, CheckCacheConfig, NmrConfig } from '../defineConfig.ts';
import { defineConfig } from '../defineConfig.ts';
import { isObject } from '../helpers/type-guards.ts';

/** The entry module's basename. The `./config` subpath's targets are this name with the built extensions. */
const ENTRY_BASENAME = 'defineConfig';

const packageRoot = path.resolve(import.meta.dirname, '../..');

describe(defineConfig, () => {
  it('returns the config unchanged (identity function)', () => {
    const config = {
      workspaceScripts: {
        'copy-content': 'tsx scripts/copy-content.ts',
      },
      rootScripts: {
        demo: 'pnpx http-server --port=5189',
      },
    };

    expect(defineConfig(config)).toBe(config);
  });

  it('accepts string[] values for script definitions', () => {
    const config = defineConfig({
      workspaceScripts: {
        verify: ['compile', 'test'],
      },
    });

    expect(config.workspaceScripts?.verify).toStrictEqual(['compile', 'test']);
  });

  it('accepts an empty config', () => {
    expect(defineConfig({})).toStrictEqual({});
  });

  it('accepts a config with checkCache', () => {
    const config = defineConfig({
      checkCache: { enabled: false, excludeCommands: ['test'], extraCommands: ['verify'] },
    });

    expect(config.checkCache).toStrictEqual({
      enabled: false,
      excludeCommands: ['test'],
      extraCommands: ['verify'],
    });
  });

  it('accepts a config with devBin', () => {
    const config = defineConfig({
      devBin: {
        'my-cli': 'tsx packages/my-cli/src/cli.ts',
      },
    });

    expect(config.devBin).toStrictEqual({ 'my-cli': 'tsx packages/my-cli/src/cli.ts' });
  });

  it('rejects a key the config shape does not declare', () => {
    const config = defineConfig({
      // @ts-expect-error -- unrecognized config key
      workspacScripts: {},
    });

    expect(config).toStrictEqual({ workspacScripts: {} });
  });

  it('is typed by the config types the entry re-exports', () => {
    const build: BuildConfig = { extraIgnorePatterns: ['**/fixtures/**'] };
    const checkCache: CheckCacheConfig = { enabled: false };
    const config: NmrConfig = defineConfig({ build, checkCache });

    expect(config.build).toBe(build);
    expect(config.checkCache).toBe(checkCache);
  });
});

describe('the ./config subpath', () => {
  it('targets the entry module and its declarations', () => {
    const manifest: unknown = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const exportsMap = isObject(manifest) && isObject(manifest.exports) ? manifest.exports : {};

    expect(exportsMap['./config']).toStrictEqual({
      types: `./dist/esm/${ENTRY_BASENAME}.d.ts`,
      default: `./dist/esm/${ENTRY_BASENAME}.js`,
    });
  });

  it('names a module that exists in source', () => {
    expect(existsSync(path.join(packageRoot, 'src', `${ENTRY_BASENAME}.ts`))).toBe(true);
  });
});
