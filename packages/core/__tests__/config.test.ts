import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defineConfig, loadConfig } from '../src/config.js';

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

describe('defineConfig', () => {
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
        build: ['compile', 'generate-typings'],
      },
    });

    expect(config.workspaceScripts?.['build']).toEqual(['compile', 'generate-typings']);
  });

  it('accepts an empty config', () => {
    expect(defineConfig({})).toEqual({});
  });
});

describe('loadConfig', () => {
  it('returns empty config when config file does not exist', async () => {
    const config = await loadConfig(MONOREPO_ROOT);
    // The test monorepo doesn't have .config/nmr.config.ts yet
    expect(config).toEqual({});
  });

  it('returns empty config for a non-existent directory', async () => {
    const config = await loadConfig('/tmp/nonexistent-monorepo-root');
    expect(config).toEqual({});
  });
});
