import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { LabelSpec, ReleaseKitConfig, RepoLabelsConfig } from '../defineConfig.ts';
import { defineConfig } from '../defineConfig.ts';
import type {
  LabelSpec as BarrelLabelSpec,
  ReleaseKitConfig as BarrelReleaseKitConfig,
  RepoLabelsConfig as BarrelRepoLabelsConfig,
} from '../index.ts';

/** The entry module's basename. The `./config` subpath's targets are this name with the built extensions. */
const ENTRY_BASENAME = 'defineConfig';

const packageRoot = path.resolve(import.meta.dirname, '../..');

describe(defineConfig, () => {
  it('returns the config it is given', () => {
    const config: ReleaseKitConfig = { formatCommand: 'npx prettier --write' };

    expect(defineConfig(config)).toBe(config);
  });

  it('rejects a property the config schema does not declare', () => {
    const config = defineConfig({
      // `releaseKitConfigSchema` is strict, so the inferred type carries no index signature and excess-property
      // checking fires on this literal.
      // @ts-expect-error -- unknown config property
      unknownOption: true,
    });

    expect(config).toStrictEqual({ unknownOption: true });
  });

  it('is typed by the config types the entry re-exports', () => {
    const labels: Record<string, LabelSpec | null> = { bug: { color: 'b60205' } };
    const repoLabels: RepoLabelsConfig = { extends: ['common'], labels };
    const config: ReleaseKitConfig = defineConfig({ repoLabels });

    expect(config.repoLabels).toBe(repoLabels);
  });
});

describe('the ./config subpath', () => {
  it('targets the entry module and its declarations', () => {
    const manifest: { exports: Record<string, unknown> } = JSON.parse(
      readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    );

    expect(manifest.exports['./config']).toStrictEqual({
      types: `./dist/esm/${ENTRY_BASENAME}.d.ts`,
      import: `./dist/esm/${ENTRY_BASENAME}.js`,
    });
  });

  it('names a module that exists in source', () => {
    expect(existsSync(path.join(packageRoot, 'src', `${ENTRY_BASENAME}.ts`))).toBe(true);
  });
});

describe('the package barrel', () => {
  it('no longer exports defineConfig', async () => {
    const barrel: Record<string, unknown> = await import('../index.ts');

    expect(barrel).not.toHaveProperty('defineConfig');
  });

  // Typing values with the barrel's aliases is the assertion: a config written as `import type { ReleaseKitConfig }`
  // keeps working without the barrel's `defineConfig`, so all three names have to stay reachable there.
  it('still exports the config types', () => {
    const labels: Record<string, BarrelLabelSpec | null> = { bug: { color: 'b60205' } };
    const repoLabels: BarrelRepoLabelsConfig = { extends: ['common'], labels };
    const config: BarrelReleaseKitConfig = { repoLabels };

    expect(config.repoLabels).toBe(repoLabels);
  });
});
