import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  noReExportOnlyVitestConfigs,
  noRetiredInfixTests,
  noRetiredVitestConfigs,
  vitestConfigBuildsOnSharedConfig,
  vitestRootConfigBuildsOnSharedConfig,
} from '../../.readyup/kits/default.ts';

const SHARED_CONFIG =
  "import { defineVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineVitestConfig();\n";
const SHARED_ROOT_CONFIG =
  "import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });\n";

const fixtureDirs: string[] = [];

describe(noRetiredVitestConfigs, () => {
  afterEach(() => {
    for (const dir of fixtureDirs) {
      rmSync(dir, { force: true, recursive: true });
    }
    fixtureDirs.length = 0;
  });

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

describe(noRetiredInfixTests, () => {
  it('passes when tests carry a live tier infix', () => {
    const dir = buildRepo({
      'packages/api/src/__tests__/api.tool.test.ts': '',
      'packages/api/src/__tests__/api.unit.test.ts': '',
      'packages/web/src/__tests__/web.test.tsx': '',
    });

    expect(noRetiredInfixTests(dir)).toBe(true);
  });

  it('reports both retired infixes together', () => {
    const dir = buildRepo({
      'packages/api/src/__tests__/api.int.test.ts': '',
      'packages/web/src/__tests__/web.integration.test.tsx': '',
    });

    const detail = detailOf(noRetiredInfixTests(dir));
    expect(detail).toContain('2 found');
    expect(detail).toContain('packages/api/src/__tests__/api.int.test.ts');
    expect(detail).toContain('packages/web/src/__tests__/web.integration.test.tsx');
  });

  // `.drift.` never matched a project, so a repo carrying it already ran those files under the residual.
  it('leaves an infix that never selected a project alone', () => {
    const dir = buildRepo({ '__tests__/readme.drift.test.ts': '' });

    expect(noRetiredInfixTests(dir)).toBe(true);
  });

  it('ignores a retired infix outside __tests__, which no project collects', () => {
    const dir = buildRepo({ 'packages/api/src/fixtures/legacy.integration.test.ts': '' });

    expect(noRetiredInfixTests(dir)).toBe(true);
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

/**
 * Builds a fixture repo in a temp directory from a path-to-content map.
 *
 * Temp directories rather than committed fixtures: a file named `*.integration.test.ts` under any `__tests__/`
 * directory would match this repo's own `unit` project include pattern and be collected as a test.
 */
function buildRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-kit-'));
  fixtureDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }

  return dir;
}

/** Extracts the detail string from a failing check outcome. */
function detailOf(outcome: boolean | { ok: boolean; detail?: string | undefined }): string {
  expect(outcome).toBeTypeOf('object');
  if (typeof outcome === 'boolean') throw new TypeError('expected a CheckOutcome');
  expect(outcome.ok).toBe(false);
  return outcome.detail ?? '';
}
