import { describe, expect, it } from 'vitest';

import { tazeConfigBuildsOnSharedConfig } from '../../.readyup/kits/default.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

const SHARED_CONFIG = "import { defineConfig } from '@williamthorsen/nmr/taze';\nexport default defineConfig({});\n";

describe(tazeConfigBuildsOnSharedConfig, () => {
  // unconfig resolves any of these, so a check matching only `.ts` would report a conformant repo as stale.
  it.each(['taze.config.ts', 'taze.config.mts', 'taze.config.cts', 'taze.config.js', 'taze.config.mjs'])(
    'passes when %s builds on the shared config',
    (filename) => {
      const dir = buildRepo({ [filename]: SHARED_CONFIG });

      expect(tazeConfigBuildsOnSharedConfig(dir)).toBe(true);
    },
  );

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
