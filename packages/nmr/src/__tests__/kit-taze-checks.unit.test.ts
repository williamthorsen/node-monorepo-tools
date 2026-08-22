import { describe, expect, it } from 'vitest';

import { tazeConfigAvoidsClobberedOptions, tazeConfigBuildsOnSharedConfig } from '../../.readyup/kits/default.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

const SHARED_CONFIG = "import { defineConfig } from '@williamthorsen/nmr/taze';\nexport default defineConfig({});\n";

describe(tazeConfigBuildsOnSharedConfig, () => {
  // unconfig resolves any of these, so a check matching only `.ts` would report a conformant repo as stale.
  it.each([
    'taze.config.ts',
    'taze.config.mts',
    'taze.config.cts',
    'taze.config.js',
    'taze.config.mjs',
    'taze.config.cjs',
  ])('passes when %s builds on the shared config', (filename) => {
    const dir = buildRepo({ [filename]: SHARED_CONFIG });

    expect(tazeConfigBuildsOnSharedConfig(dir)).toBe(true);
  });

  // The policy reaches a repo only through this file, so absence is the finding the check exists for.
  it('fails a repo that declares no taze config at all', () => {
    const dir = buildRepo({ 'package.json': '{}\n' });

    expect(getDetail(tazeConfigBuildsOnSharedConfig(dir))).toContain('taze.config.ts is missing');
  });

  it('fails when the config declares its own options instead', () => {
    const dir = buildRepo({ 'taze.config.ts': 'export default { mode: "major" };\n' });

    expect(getDetail(tazeConfigBuildsOnSharedConfig(dir))).toContain('taze.config.ts');
  });

  it('fails when the config imports a different export from the shared module', () => {
    const dir = buildRepo({
      'taze.config.ts':
        "import { definePrettierConfig } from '@williamthorsen/nmr/prettier';\nexport default definePrettierConfig();\n",
    });

    expect(getDetail(tazeConfigBuildsOnSharedConfig(dir))).toContain('taze.config.ts');
  });

  // taze reads a data-only config, so skipping one would report the repo as conformant when it carries no policy.
  it.each(['.tazerc', '.tazerc.json', 'taze.config.json'])('fails a repo whose only config is %s', (filename) => {
    const dir = buildRepo({ [filename]: '{}\n' });

    const detail = getDetail(tazeConfigBuildsOnSharedConfig(dir));
    expect(detail).toContain('holds no code to call the factory');
    expect(detail).toContain(filename);
  });

  it('reports every stale config when more than one spelling is present', () => {
    const dir = buildRepo({
      'taze.config.js': 'export default {};\n',
      'taze.config.ts': 'export default {};\n',
    });

    const detail = getDetail(tazeConfigBuildsOnSharedConfig(dir));
    expect(detail).toContain('taze.config.js');
    expect(detail).toContain('taze.config.ts');
  });
});

describe(tazeConfigAvoidsClobberedOptions, () => {
  it('passes a config declaring none of the discarded options', () => {
    const dir = buildRepo({ 'taze.config.ts': buildConfig("packageMode: { typescript: 'minor' }") });

    expect(tazeConfigAvoidsClobberedOptions(dir)).toBe(true);
  });

  it('passes a repo that declares no taze config at all', () => {
    const dir = buildRepo({ 'package.json': '{}\n' });

    expect(tazeConfigAvoidsClobberedOptions(dir)).toBe(true);
  });

  // taze's CLI carries a default for these two, so whatever the config declares is discarded.
  it.each([
    ['requestTimeout: 60000', 'requestTimeout'],
    ['requestTimeout: 0', 'requestTimeout'],
    ['concurrency: 4', 'concurrency'],
  ])('reports %s, whose value never reaches taze', (setting, key) => {
    const dir = buildRepo({ 'taze.config.ts': buildConfig(setting) });

    expect(getDetail(tazeConfigAvoidsClobberedOptions(dir))).toContain(key);
  });

  // These three carry a CLI default matching taze's own, so only a departure from it is lost.
  it.each([
    ['githubActions: false', 'githubActions'],
    ["githubActions: { style: 'tag' }", 'githubActions'],
    ['ignoreOtherWorkspaces: false', 'ignoreOtherWorkspaces'],
    ['nodeVersion: false', 'nodeVersion'],
  ])('reports %s, which departs from the default the CLI reasserts', (setting, key) => {
    const dir = buildRepo({ 'taze.config.ts': buildConfig(setting) });

    expect(getDetail(tazeConfigAvoidsClobberedOptions(dir))).toContain(key);
  });

  // The reasserted default equals taze's own, so a config restating it loses nothing and is not a finding.
  it.each(['githubActions: true', 'ignoreOtherWorkspaces: true', 'nodeVersion: true'])(
    'passes %s, which taze honors anyway',
    (setting) => {
      const dir = buildRepo({ 'taze.config.ts': buildConfig(setting) });

      expect(tazeConfigAvoidsClobberedOptions(dir)).toBe(true);
    },
  );

  // unconfig resolves any of these, so a check matching only `.ts` would miss a config that carries the setting.
  it.each([
    'taze.config.ts',
    'taze.config.mts',
    'taze.config.cts',
    'taze.config.js',
    'taze.config.mjs',
    'taze.config.cjs',
  ])('inspects %s', (filename) => {
    const dir = buildRepo({ [filename]: buildConfig('requestTimeout: 60000') });

    expect(getDetail(tazeConfigAvoidsClobberedOptions(dir))).toContain(filename);
  });

  it('names every discarded option a config declares', () => {
    const dir = buildRepo({
      'taze.config.ts': buildConfig('requestTimeout: 60000, concurrency: 4, nodeVersion: false'),
    });

    const detail = getDetail(tazeConfigAvoidsClobberedOptions(dir));
    expect(detail).toContain('requestTimeout');
    expect(detail).toContain('concurrency');
    expect(detail).toContain('nodeVersion');
  });
});

/** Builds a shared-config taze file carrying `settings`, the form the sibling check requires. */
function buildConfig(settings: string): string {
  return `import { defineConfig } from '@williamthorsen/nmr/taze';\nexport default defineConfig({ ${settings} });\n`;
}
