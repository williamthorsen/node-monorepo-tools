import { pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import {
  everyTestFileNamesItsTier,
  everyViteConfigHasVitestConfig,
  noReExportOnlyVitestConfigs,
  noRetiredVitestConfigs,
  vitestConfigBuildsOnSharedConfig,
  vitestRootConfigBuildsOnSharedConfig,
} from '../../.readyup/kits/default.ts';
import { buildMonorepo, buildRepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

const SHARED_CONFIG =
  "import { defineVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineVitestConfig();\n";
const SHARED_ROOT_CONFIG =
  "import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });\n";

describe(noRetiredVitestConfigs, () => {
  it('passes when no retired variant survives', () => {
    const dir = buildRepo({ 'vitest.config.ts': SHARED_CONFIG });

    expect(noRetiredVitestConfigs(dir)).toBe(true);
  });

  it('reports both retired variants wherever they sit', () => {
    const dir = buildRepo({
      'packages/api/vitest.integration.config.ts': 'export default {};\n',
      'vitest.standalone.config.ts': 'export default {};\n',
    });

    const detail = getDetail(noRetiredVitestConfigs(dir));
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

    expect(getDetail(noRetiredVitestConfigs(dir))).toContain('vitest.standalone.config.mts');
  });
});

describe(vitestConfigBuildsOnSharedConfig, () => {
  it('passes when the root config imports defineVitestConfig', () => {
    useMonorepo({ 'vitest.config.ts': SHARED_CONFIG });

    expect(vitestConfigBuildsOnSharedConfig()).toBe(true);
  });

  it('reports a missing root config', () => {
    useMonorepo({});

    expect(getDetail(vitestConfigBuildsOnSharedConfig())).toBe('vitest.config.ts is missing');
  });

  it('reports a hand-rolled root config', () => {
    useMonorepo({
      'vitest.config.ts': "import { defineConfig } from 'vitest/config';\nexport default defineConfig({});\n",
    });

    expect(getDetail(vitestConfigBuildsOnSharedConfig())).toContain('does not import defineVitestConfig');
  });

  it('is not satisfied by vitest.root.config.ts alone', () => {
    useMonorepo({ 'vitest.root.config.ts': SHARED_ROOT_CONFIG });

    expect(getDetail(vitestConfigBuildsOnSharedConfig())).toBe('vitest.config.ts is missing');
  });

  it('reports a workspace config that does not call the factory', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/vitest.config.ts':
        "import { defineConfig } from 'vitest/config';\nexport default defineConfig({});\n",
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(getDetail(vitestConfigBuildsOnSharedConfig())).toContain('packages/api/vitest.config.ts');
  });

  it('passes a workspace config that calls the factory with its own layers', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/vitest.config.ts':
        "import { defineVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineVitestConfig({ project: { environment: 'jsdom' } });\n",
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(vitestConfigBuildsOnSharedConfig()).toBe(true);
  });

  // The delete check owns this one, and its fix is correct here: nothing in the directory would take over
  // resolution. Reporting it twice would hand the reader two fixes that contradict each other.
  it('leaves a re-export-only workspace config to the delete check', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/vitest.config.ts': 'export { default } from "../../vitest.config.ts";\n',
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(vitestConfigBuildsOnSharedConfig()).toBe(true);
  });

  it('reports a re-export-only workspace config sitting beside a Vite config', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/vite.config.ts': 'export default {};\n',
      'packages/api/vitest.config.ts': 'export { default } from "../../vitest.config.ts";\n',
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(getDetail(vitestConfigBuildsOnSharedConfig())).toContain('packages/api/vitest.config.ts');
  });

  it('ignores a config below a workspace root, which no run resolves', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/src/vitest.config.ts':
        "import { defineConfig } from 'vitest/config';\nexport default defineConfig({});\n",
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(vitestConfigBuildsOnSharedConfig()).toBe(true);
  });
});

describe(everyViteConfigHasVitestConfig, () => {
  it('passes when no workspace carries a Vite config', () => {
    useMonorepo({ 'packages/api/package.json': '{ "name": "api" }\n', 'vitest.config.ts': SHARED_CONFIG });

    expect(everyViteConfigHasVitestConfig()).toBe(true);
  });

  it('reports the unpaired Vite config by path', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/vite.config.ts': 'export default {};\n',
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(getDetail(everyViteConfigHasVitestConfig())).toContain('packages/api/vite.config.ts');
  });

  it('passes when a Vitest config sits beside the Vite config', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/vite.config.ts': 'export default {};\n',
      'packages/api/vitest.config.ts': SHARED_CONFIG,
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(everyViteConfigHasVitestConfig()).toBe(true);
  });

  it('matches config extensions beyond .ts on both sides', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/vite.config.mts': 'export default {};\n',
      'packages/api/vitest.config.mts': SHARED_CONFIG,
      'packages/web/package.json': '{ "name": "web" }\n',
      'packages/web/vite.config.mjs': 'export default {};\n',
      'vitest.config.ts': SHARED_CONFIG,
    });

    const detail = getDetail(everyViteConfigHasVitestConfig());
    expect(detail).toContain('packages/web/vite.config.mjs');
    expect(detail).not.toContain('packages/api');
  });

  // Vitest's config search only ascends from the run root, so neither of these is ever resolved from the
  // workspace whose tests would run.
  it('ignores a Vite config nested below a workspace root', () => {
    useMonorepo({
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/src/vite.config.ts': 'export default {};\n',
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(everyViteConfigHasVitestConfig()).toBe(true);
  });

  it('ignores a Vite config at the repo root, which the root-config check reports', () => {
    useMonorepo({ 'vite.config.ts': 'export default {};\n' });

    expect(everyViteConfigHasVitestConfig()).toBe(true);
  });

  it('yields no finding where the root manifest is unreadable', () => {
    const dir = buildRepo({ 'packages/api/vite.config.ts': 'export default {};\n' });
    disposeOnTestFinished(pointCwdAt(dir));

    expect(everyViteConfigHasVitestConfig()).toBe(true);
  });
});

describe(vitestRootConfigBuildsOnSharedConfig, () => {
  it('passes when the root-tests config imports defineRootVitestConfig', () => {
    const dir = buildRepo({ 'vitest.root.config.ts': SHARED_ROOT_CONFIG });

    expect(vitestRootConfigBuildsOnSharedConfig(dir)).toBe(true);
  });

  it('reports a missing root-tests config', () => {
    const dir = buildRepo({ 'vitest.config.ts': SHARED_CONFIG });

    expect(getDetail(vitestRootConfigBuildsOnSharedConfig(dir))).toBe('vitest.root.config.ts is missing');
  });

  it('is not satisfied by a config importing only defineVitestConfig', () => {
    const dir = buildRepo({ 'vitest.root.config.ts': SHARED_CONFIG });

    expect(getDetail(vitestRootConfigBuildsOnSharedConfig(dir))).toContain('does not import defineRootVitestConfig');
  });
});

describe(everyTestFileNamesItsTier, () => {
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

    const detail = getDetail(everyTestFileNamesItsTier(dir));
    expect(detail).toContain('2 found');
    expect(detail).toContain('packages/api/src/__tests__/api.test.ts');
    expect(detail).toContain('packages/web/src/__tests__/web.smoke.test.tsx');
  });

  // Vitest collects these, so a check globbing for them would pass clean over a repo whose kit tests all run untiered.
  it('reports a misnamed file under a dot-directory', () => {
    const dir = buildRepo({ '.readyup/kits/__tests__/kit.test.ts': '' });

    expect(getDetail(everyTestFileNamesItsTier(dir))).toContain('.readyup/kits/__tests__/kit.test.ts');
  });

  it('passes a file carrying an aspect segment ahead of its tier', () => {
    const dir = buildRepo({ 'packages/api/src/__tests__/scaffold.packaged.unit.test.ts': '' });

    expect(everyTestFileNamesItsTier(dir)).toBe(true);
  });

  // The retired-infix check this replaces reported the same file, so keeping both would double-report it.
  it('reports a retired infix once, as the untiered file it is', () => {
    const dir = buildRepo({ 'packages/api/src/__tests__/api.int.test.ts': '' });

    const detail = getDetail(everyTestFileNamesItsTier(dir));
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

    expect(getDetail(noReExportOnlyVitestConfigs(dir))).toContain('packages/api/vitest.config.ts');
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

  // Deleting this one would hand resolution to the Vite config beside it, which is the failure the pairing
  // check exists to prevent. The content check reports it instead, telling it to call the factory.
  it('leaves a re-export beside a Vite config alone, which resolution then depends on', () => {
    const dir = buildRepo({
      'packages/api/vite.config.ts': 'export default {};\n',
      'packages/api/vitest.config.ts': 'export { default } from "../../vitest.config.ts";\n',
      'vitest.config.ts': SHARED_CONFIG,
    });

    expect(noReExportOnlyVitestConfigs(dir)).toBe(true);
  });

  it('never reports the root config, which is the re-export target', () => {
    const dir = buildRepo({ 'vitest.config.ts': 'export { default } from "../other.ts";\n' });

    expect(noReExportOnlyVitestConfigs(dir)).toBe(true);
  });
});

// region | Helpers

/** Builds a fixture monorepo and points `process.cwd()` at it, which is what workspace discovery reads. */
function useMonorepo(files: Record<string, string>): void {
  disposeOnTestFinished(pointCwdAt(buildMonorepo(files)));
}

// endregion | Helpers
