import fs from 'node:fs';
import os from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defineConfig, loadConfig } from '../src/config.js';

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

    expect(config.workspaceScripts?.build).toEqual(['compile', 'generate-typings']);
  });

  it('accepts an empty config', () => {
    expect(defineConfig({})).toEqual({});
  });

  it('accepts a config with devBin', () => {
    const config = defineConfig({
      devBin: {
        'my-cli': 'tsx packages/my-cli/src/cli.ts',
      },
    });

    expect(config.devBin).toEqual({ 'my-cli': 'tsx packages/my-cli/src/cli.ts' });
  });
});

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(os.tmpdir() + '/nmr-config-test-');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty config when config file does not exist', async () => {
    const config = await loadConfig(tmpDir);
    expect(config).toEqual({});
  });

  it('returns empty config for a non-existent directory', async () => {
    const config = await loadConfig('/tmp/nonexistent-monorepo-root');
    expect(config).toEqual({});
  });
});
