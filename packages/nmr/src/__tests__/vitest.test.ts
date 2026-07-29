import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { globSync } from 'tinyglobby';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestProjectConfiguration, TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';

import { defineRootVitestConfig, defineVitestConfig } from '../vitest.ts';

// Files the fixture tree holds, each chosen for a category boundary the config has to get right.
const FIXTURE_FILES = [
  'node_modules/pkg/__tests__/dep.test.ts', // excluded by Vitest's own defaults
  'src/__tests__/nested/deep.test.tsx', // nested, and the tsx branch of the brace expansion
  'src/__tests__/plain.test.ts',
  'src/__tests__/thing.app.test.ts',
  'src/__tests__/thing.int.test.ts',
  'src/__tests__/thing.smoke.test.ts', // a suffix matching no category
  'src/outside.test.ts', // outside a `__tests__` directory
];

describe(defineVitestConfig, () => {
  it('declares the three categories, each inheriting the root config', () => {
    const projects = getProjects(defineVitestConfig());

    expect(projects.map((project) => project.test?.name)).toStrictEqual(['app', 'integration', 'unit']);
    expect(projects.map((project) => project.extends)).toStrictEqual([true, true, true]);
  });

  it('keeps per-project options out of the root test block', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(Object.keys(rootTest).toSorted()).toStrictEqual(['coverage', 'projects', 'silent', 'watch']);
  });

  it('carries over the settings the shared config has always applied', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(rootTest.silent).toBe('passed-only');
    expect(rootTest.watch).toBe(false);
    expect(rootTest.coverage?.provider).toBe('v8');
    expect(rootTest.coverage?.enabled).toBe(false);
    expect(rootTest.coverage?.include).toStrictEqual(['**/src/**/*.{ts,tsx}']);
  });

  it('extends the default exclusions from Vitest rather than replacing them', () => {
    for (const project of getProjects(defineVitestConfig())) {
      expect(project.test?.exclude).toEqual(expect.arrayContaining(['**/node_modules/**', '**/.git/**']));
    }
  });

  it('applies a project override to every project', () => {
    const projects = getProjects(defineVitestConfig({ project: { setupFiles: ['./setup.ts'] } }));

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual([
      ['./setup.ts'],
      ['./setup.ts'],
      ['./setup.ts'],
    ]);
  });

  it('applies a root override to the root config', () => {
    const config = defineVitestConfig({ root: { resolve: { conditions: ['development'] } } });

    expect(config.resolve?.conditions).toStrictEqual(['development']);
  });

  it('merges a root override into the existing block rather than replacing it', () => {
    const config = defineVitestConfig({ root: { test: { coverage: { reportsDirectory: './cov' } } } });

    expect(config.test?.coverage?.reportsDirectory).toBe('./cov');
    expect(config.test?.coverage?.provider).toBe('v8');
  });

  it('rejects a per-project option in the root seam', () => {
    const config = defineVitestConfig({
      root: {
        test: {
          // @ts-expect-error - a per-project option belongs in the `project` seam, not in `root`
          setupFiles: ['./setup.ts'],
        },
      },
    });

    expect(config.test?.projects).toHaveLength(3);
  });
});

describe(defineRootVitestConfig, () => {
  it('excludes every workspace package from every project', () => {
    for (const project of getProjects(defineRootVitestConfig())) {
      expect(project.test?.exclude).toContain('packages/nmr/**');
    }
  });

  it('applies the workspace exclusion to the projects, not the root test block', () => {
    const rootTest = defineRootVitestConfig().test ?? {};

    expect(rootTest).not.toHaveProperty('exclude');
    expect(rootTest).not.toHaveProperty('include');
  });

  it('reports no coverage of its own', () => {
    expect(defineRootVitestConfig().test?.coverage?.include).toStrictEqual([]);
  });
});

describe('project file selection', () => {
  let fixtureRoot: string;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), 'nmr-vitest-test-'));
    for (const file of FIXTURE_FILES) {
      const absolute = path.join(fixtureRoot, file);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, '');
    }
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('selects only integration tests for the integration project', () => {
    expect(selectFiles('integration', fixtureRoot)).toStrictEqual(['src/__tests__/thing.int.test.ts']);
  });

  it('selects only app tests for the app project', () => {
    expect(selectFiles('app', fixtureRoot)).toStrictEqual(['src/__tests__/thing.app.test.ts']);
  });

  it('runs a file whose suffix matches no category under the unit project', () => {
    expect(selectFiles('unit', fixtureRoot)).toContain('src/__tests__/thing.smoke.test.ts');
  });

  it('leaves categorised, unnested, and excluded files out of the unit project', () => {
    expect(selectFiles('unit', fixtureRoot)).toStrictEqual([
      'src/__tests__/nested/deep.test.tsx',
      'src/__tests__/plain.test.ts',
      'src/__tests__/thing.smoke.test.ts',
    ]);
  });
});

/** Narrows the declared projects to the inline form, which is the only form the factories emit. */
function getProjects(config: ViteUserConfig): TestProjectInlineConfiguration[] {
  return (config.test?.projects ?? []).filter(isInlineProject);
}

function isInlineProject(project: TestProjectConfiguration): project is TestProjectInlineConfiguration {
  return typeof project === 'object' && !(project instanceof Promise);
}

/** Resolves a project's patterns against the fixture tree using the engine Vitest discovers with. */
function selectFiles(name: string, cwd: string): string[] {
  const project = getProjects(defineVitestConfig()).find(({ test }) => test?.name === name);

  return globSync(project?.test?.include ?? [], { cwd, ignore: project?.test?.exclude ?? [] }).toSorted();
}
