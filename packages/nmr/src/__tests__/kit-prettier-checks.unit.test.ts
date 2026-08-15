import { afterEach, describe, expect, it } from 'vitest';

import { prettierConfigBuildsOnSharedConfig } from '../../.readyup/kits/default.ts';
import { buildRepo, removeFixtureDirs } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

const SHARED_CONFIG =
  "import { definePrettierConfig } from '@williamthorsen/nmr/prettier';\nexport default definePrettierConfig();\n";

describe(prettierConfigBuildsOnSharedConfig, () => {
  afterEach(removeFixtureDirs);

  // Both spellings are configs Prettier reads, so a check matching only one would report a
  // conformant repo as stale. This repo uses the `.prettierrc.js` form.
  it.each(['.prettierrc.js', '.prettierrc.mjs', '.prettierrc.ts', 'prettier.config.js', 'prettier.config.mts'])(
    'passes when %s builds on the shared config',
    (filename) => {
      const dir = buildRepo({ [filename]: SHARED_CONFIG });

      expect(prettierConfigBuildsOnSharedConfig(dir)).toBe(true);
    },
  );

  it('fails when the config declares its own options instead', () => {
    const dir = buildRepo({ '.prettierrc.js': 'export default { singleQuote: true };\n' });

    expect(getDetail(prettierConfigBuildsOnSharedConfig(dir))).toContain('.prettierrc.js');
  });

  it('fails when the config imports a different export from the shared module', () => {
    const dir = buildRepo({
      'prettier.config.js':
        "import { defineVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineVitestConfig();\n",
    });

    expect(getDetail(prettierConfigBuildsOnSharedConfig(dir))).toContain('prettier.config.js');
  });

  it('reports every stale config when both spellings are present', () => {
    const dir = buildRepo({
      '.prettierrc.js': 'export default {};\n',
      'prettier.config.js': 'export default {};\n',
    });

    const detail = getDetail(prettierConfigBuildsOnSharedConfig(dir));
    expect(detail).toContain('.prettierrc.js');
    expect(detail).toContain('prettier.config.js');
  });

  // A data-only config cannot call a factory at all, so skipping it would read as conformant.
  it.each(['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.toml'])(
    'fails a repo whose only config is %s',
    (filename) => {
      const dir = buildRepo({ [filename]: '{}\n' });

      expect(getDetail(prettierConfigBuildsOnSharedConfig(dir))).toContain(filename);
    },
  );

  it('fails a repo configuring Prettier through the package.json key', () => {
    const dir = buildRepo({ 'package.json': '{\n  "prettier": { "singleQuote": true }\n}\n' });

    expect(getDetail(prettierConfigBuildsOnSharedConfig(dir))).toContain('package.json');
  });

  it('reports a missing config rather than a data-only one when there is neither', () => {
    const dir = buildRepo({ 'package.json': '{\n  "name": "repo"\n}\n' });

    expect(getDetail(prettierConfigBuildsOnSharedConfig(dir))).toContain('missing');
  });

  // Every repo this check runs against carries `prettier` as a dependency, so mistaking that entry for a config
  // key would make the misreport the common case rather than the edge one.
  it('reads prettier in devDependencies as a dependency, not as a config key', () => {
    const dir = buildRepo({
      'package.json': '{\n  "name": "repo",\n  "devDependencies": {\n    "prettier": "3.9.6"\n  }\n}\n',
    });

    expect(getDetail(prettierConfigBuildsOnSharedConfig(dir))).toContain('missing');
  });

  it('reports a malformed package.json as a missing config rather than throwing', () => {
    const dir = buildRepo({ 'package.json': '{ not json\n' });

    expect(getDetail(prettierConfigBuildsOnSharedConfig(dir))).toContain('missing');
  });

  it('ignores a config inside a nested node_modules', () => {
    const dir = buildRepo({ 'node_modules/dep/.prettierrc.js': 'export default {};\n' });

    expect(getDetail(prettierConfigBuildsOnSharedConfig(dir))).toContain('missing');
  });
});
