import { afterEach, describe, expect, it } from 'vitest';

import {
  everyTestFileNamesItsTier,
  noReExportOnlyVitestConfigs,
  noRetiredVitestConfigs,
  vitestConfigBuildsOnSharedConfig,
  vitestRootConfigBuildsOnSharedConfig,
} from '../../.readyup/kits/default.ts';
import { detailOf } from '../test-utils/detailOf.ts';
import { buildRepo, removeFixtureDirs } from '../test-utils/fixture-repo.ts';

const SHARED_CONFIG =
  "import { defineVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineVitestConfig();\n";
const SHARED_ROOT_CONFIG =
  "import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });\n";

describe(noRetiredVitestConfigs, () => {
  afterEach(removeFixtureDirs);

  it('passes when no retired variant survives', () => {
    const dir = buildRepo({ 'vitest.config.ts': SHARED_CONFIG });

    expect(noRetiredVitestConfigs(dir)).toBe(true);
  });

  it('reports both retired variants wherever they sit', () => {
    const dir = buildRepo({
      'packages/api/vitest.integration.config.ts': 'export default {};\n',
      'vitest.standalone.config.ts': 'export default {};\n',
    });

    const detail = detailOf(noRetiredVitestConfigs(dir));
    expect(detail).toContain('2 found');
    expect(detail).toContain('packages/api/vitest.integration.config.ts');
    expect(detail).toContain('vitest.standalone.config.ts');
  });

  it('ignores a retired variant inside a nested node_modules', () => {
    const dir = buildRepo({
      'packages/api/node_modules/dep/vitest.integration.config.ts': 'export default {};\n',
    });

    expect(noRetiredVitestConfigs(dir)).toBe(true);
  });

  it('matches config extensions beyond .ts', () => {
    const dir = buildRepo({ 'vitest.standalone.config.mts': 'export default {};\n' });

    expect(detailOf(noRetiredVitestConfigs(dir))).toContain('vitest.standalone.config.mts');
  });
});

describe(vitestConfigBuildsOnSharedConfig, () => {
  afterEach(removeFixtureDirs);

  it('passes when the root config imports defineVitestConfig', () => {
    const dir = buildRepo({ 'vitest.config.ts': SHARED_CONFIG });

    expect(vitestConfigBuildsOnSharedConfig(dir)).toBe(true);
  });

  it('reports a missing root config', () => {
    const dir = buildRepo({ 'package.json': '{}\n' });

    expect(detailOf(vitestConfigBuildsOnSharedConfig(dir))).toBe('vitest.config.ts is missing');
  });

  it('reports a hand-rolled root config', () => {
    const dir = buildRepo({
      'vitest.config.ts': "import { defineConfig } from 'vitest/config';\nexport default defineConfig({});\n",
    });

    expect(detailOf(vitestConfigBuildsOnSharedConfig(dir))).toContain('does not import defineVitestConfig');
  });

  it('is not satisfied by vitest.root.config.ts alone', () => {
    const dir = buildRepo({ 'vitest.root.config.ts': SHARED_ROOT_CONFIG });

    expect(detailOf(vitestConfigBuildsOnSharedConfig(dir))).toBe('vitest.config.ts is missing');
  });
});

describe(vitestRootConfigBuildsOnSharedConfig, () => {
  afterEach(removeFixtureDirs);

  it('passes when the root-tests config imports defineRootVitestConfig', () => {
    const dir = buildRepo({ 'vitest.root.config.ts': SHARED_ROOT_CONFIG });

    expect(vitestRootConfigBuildsOnSharedConfig(dir)).toBe(true);
  });

  it('reports a missing root-tests config', () => {
    const dir = buildRepo({ 'vitest.config.ts': SHARED_CONFIG });

    expect(detailOf(vitestRootConfigBuildsOnSharedConfig(dir))).toBe('vitest.root.config.ts is missing');
  });

  it('is not satisfied by a config importing only defineVitestConfig', () => {
    const dir = buildRepo({ 'vitest.root.config.ts': SHARED_CONFIG });

    expect(detailOf(vitestRootConfigBuildsOnSharedConfig(dir))).toContain('does not import defineRootVitestConfig');
  });
});

describe(everyTestFileNamesItsTier, () => {
  afterEach(removeFixtureDirs);

  it('passes when every collected file names a tier', () => {
    const dir = buildRepo({
      '.readyup/kits/__tests__/kit.unit.test.ts': '',
      'packages/api/src/__tests__/api.tool.test.ts': '',
      'packages/api/src/__tests__/api.unit.test.ts': '',
      'packages/web/src/__tests__/web.unit.test.tsx': '',
    });

    expect(everyTestFileNamesItsTier(dir)).toBe(true);
  });

  it('reports every offender by path', () => {
    const dir = buildRepo({
      'packages/api/src/__tests__/api.test.ts': '',
      'packages/api/src/__tests__/api.unit.test.ts': '',
      'packages/web/src/__tests__/web.smoke.test.tsx': '',
    });

    const detail = detailOf(everyTestFileNamesItsTier(dir));
    expect(detail).toContain('2 found');
    expect(detail).toContain('packages/api/src/__tests__/api.test.ts');
    expect(detail).toContain('packages/web/src/__tests__/web.smoke.test.tsx');
  });

  // Vitest collects these, so a check globbing for them would pass clean over a repo whose kit tests all run untiered.
  it('reports a misnamed file under a dot-directory', () => {
    const dir = buildRepo({ '.readyup/kits/__tests__/kit.test.ts': '' });

    expect(detailOf(everyTestFileNamesItsTier(dir))).toContain('.readyup/kits/__tests__/kit.test.ts');
  });

  it('passes a file carrying an aspect segment ahead of its tier', () => {
    const dir = buildRepo({ 'packages/api/src/__tests__/scaffold.packaged.unit.test.ts': '' });

    expect(everyTestFileNamesItsTier(dir)).toBe(true);
  });

  // The retired-infix check this replaces reported the same file, so keeping both would double-report it.
  it('reports a retired infix once, as the untiered file it is', () => {
    const dir = buildRepo({ 'packages/api/src/__tests__/api.int.test.ts': '' });

    const detail = detailOf(everyTestFileNamesItsTier(dir));
    expect(detail).toContain('1 found');
    expect(detail).toContain('packages/api/src/__tests__/api.int.test.ts');
  });

  it('ignores a misnamed file outside __tests__, which no project collects', () => {
    const dir = buildRepo({ 'packages/api/src/fixtures/legacy.integration.test.ts': '' });

    expect(everyTestFileNamesItsTier(dir)).toBe(true);
  });

  it('ignores a dependency owning the only misnamed file', () => {
    const dir = buildRepo({ 'node_modules/dep/__tests__/dep.test.ts': '' });

    expect(everyTestFileNamesItsTier(dir)).toBe(true);
  });
});

describe(noReExportOnlyVitestConfigs, () => {
  afterEach(removeFixtureDirs);

  it('passes when no package carries a Vitest config', () => {
    const dir = buildRepo({ 'vitest.config.ts': SHARED_CONFIG });

    expect(noReExportOnlyVitestConfigs(dir)).toBe(true);
  });

  it('reports a re-export-only package config, comments and blank lines notwithstanding', () => {
    const dir = buildRepo({
      'packages/api/vitest.config.ts':
        '/**\n * Vitest config for the api package.\n */\n\n// Inherits everything from the root.\nexport { default } from "../../vitest.config.ts";\n',
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(detailOf(noReExportOnlyVitestConfigs(dir))).toContain('packages/api/vitest.config.ts');
  });

  it('leaves a substantive package config alone', () => {
    const dir = buildRepo({
      'packages/api/vitest.config.ts':
        "import { defineVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineVitestConfig({ project: { setupFiles: ['./setup.ts'] } });\n",
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(noReExportOnlyVitestConfigs(dir)).toBe(true);
  });

  it('leaves a package-local re-export alone, which the delete fix would break', () => {
    const dir = buildRepo({
      'packages/api/vitest.base.ts': SHARED_CONFIG,
      'packages/api/vitest.config.ts': 'export { default } from "./vitest.base.ts";\n',
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(noReExportOnlyVitestConfigs(dir)).toBe(true);
  });

  it('never reports the root config, which is the re-export target', () => {
    const dir = buildRepo({ 'vitest.config.ts': 'export { default } from "../other.ts";\n' });

    expect(noReExportOnlyVitestConfigs(dir)).toBe(true);
  });
});
