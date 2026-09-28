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

  // Because the policy applies to a repo only through this file, the file's absence is the finding for which the
  // check exists.
  it('fails a repo that does not declare a taze config at all', () => {
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

  // taze reads a data-only config, so skipping one would report the repo as conformant when it does not declare any
  // policy.
  it.each(['.tazerc', '.tazerc.json', 'taze.config.json'])('fails a repo whose only config is %s', (filename) => {
    const dir = buildRepo({ [filename]: '{}\n' });

    const detail = getDetail(tazeConfigBuildsOnSharedConfig(dir));
    expect(detail).toContain('does not contain code that calls the factory');
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

  it('passes a repo that does not declare a taze config at all', () => {
    const dir = buildRepo({ 'package.json': '{}\n' });

    expect(tazeConfigAvoidsClobberedOptions(dir)).toBe(true);
  });

  // taze's CLI defines a default for these two, so whatever the config declares is discarded.
  it.each([
    ['requestTimeout: 60000', 'requestTimeout'],
    ['requestTimeout: 0', 'requestTimeout'],
    ['concurrency: 4', 'concurrency'],
  ])('reports %s, whose value taze never applies', (setting, key) => {
    const dir = buildRepo({ 'taze.config.ts': buildConfig(setting) });

    expect(getDetail(tazeConfigAvoidsClobberedOptions(dir))).toContain(key);
  });

  // The CLI's default for these three matches taze's own. Only a departure from it is lost.
  it.each([
    ['githubActions: false', 'githubActions'],
    ["githubActions: { style: 'tag' }", 'githubActions'],
    ['ignoreOtherWorkspaces: false', 'ignoreOtherWorkspaces'],
    ['nodeVersion: false', 'nodeVersion'],
  ])('reports %s, which departs from the default reasserted by the CLI', (setting, key) => {
    const dir = buildRepo({ 'taze.config.ts': buildConfig(setting) });

    expect(getDetail(tazeConfigAvoidsClobberedOptions(dir))).toContain(key);
  });

  // The reasserted default equals taze's own. A config restating it loses nothing and is not a finding.
  it.each(['githubActions: true', 'ignoreOtherWorkspaces: true', 'nodeVersion: true'])(
    'passes %s, which taze honors anyway',
    (setting) => {
      const dir = buildRepo({ 'taze.config.ts': buildConfig(setting) });

      expect(tazeConfigAvoidsClobberedOptions(dir)).toBe(true);
    },
  );

  // unconfig resolves any of these, so a check matching only `.ts` would miss a config that declares the setting.
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

  it('names every discarded option declared by a config', () => {
    const dir = buildRepo({
      'taze.config.ts': buildConfig('requestTimeout: 60000, concurrency: 4, nodeVersion: false'),
    });

    const detail = getDetail(tazeConfigAvoidsClobberedOptions(dir));
    expect(detail).toContain('requestTimeout');
    expect(detail).toContain('concurrency');
    expect(detail).toContain('nodeVersion');
  });
});

/** Builds a shared-config taze file containing `settings`, the form required by the sibling check. */
function buildConfig(settings: string): string {
  return `import { defineConfig } from '@williamthorsen/nmr/taze';\nexport default defineConfig({ ${settings} });\n`;
}
