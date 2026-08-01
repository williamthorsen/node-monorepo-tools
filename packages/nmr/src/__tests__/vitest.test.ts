import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { globSync } from 'tinyglobby';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestProjectConfiguration, TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';

import { defineRootVitestConfig, defineVitestConfig } from '../vitest.ts';

/** Every project the shared config declares, in the order it emits them: the residual, then the ladder. */
const PROJECT_NAMES = ['unit', 'tool', 'localhost', 'remote'];

// Spelled out rather than derived from the config, so the assertion fails if the derivation itself drifts.
const TIERED_PATTERNS = [
  '**/__tests__/**/*.tool.test.{ts,tsx}',
  '**/__tests__/**/*.localhost.test.{ts,tsx}',
  '**/__tests__/**/*.remote.test.{ts,tsx}',
];

// Files the fixture tree holds, each chosen for a tier boundary the config has to get right.
const FIXTURE_FILES = [
  // A build that copies sources rather than compiling them. The `dist/src/` shape is the one that also survives the
  // coverage include, so the single fixture stands for both surfaces.
  'dist/src/__tests__/copied.test.ts',
  'node_modules/pkg/__tests__/dep.test.ts', // excluded by Vitest's own defaults
  'src/__tests__/nested/deep.test.tsx', // nested, and the tsx branch of the brace expansion
  'src/__tests__/plain.test.ts',
  'src/__tests__/thing.localhost.test.ts',
  'src/__tests__/thing.remote.test.ts',
  'src/__tests__/thing.smoke.test.ts', // an infix matching no tier
  'src/__tests__/thing.tool.test.ts',
  'src/__tests__/thing.unit.test.ts', // the optional, purely informative `unit` infix
  'src/outside.test.ts', // outside a `__tests__` directory
];

describe(defineVitestConfig, () => {
  it('declares every tier, each inheriting the root config', () => {
    const projects = getProjects(defineVitestConfig());

    expect(projects.map((project) => project.test?.name)).toStrictEqual(PROJECT_NAMES);
    expect(projects.map((project) => project.extends)).toStrictEqual(PROJECT_NAMES.map(() => true));
  });

  // Vitest's 5s default is a unit-test budget. A tier test waits on something it doesn't control, and coverage
  // instrumentation multiplies that wait, so the default makes a green suite flaky once `test:coverage` collects it.
  it('gives every tier above unit a timeout that survives coverage instrumentation', () => {
    const timeouts = new Map(
      getProjects(defineVitestConfig()).map((project) => [project.test?.name, project.test?.testTimeout]),
    );

    expect(timeouts.get('unit')).toBeUndefined();
    for (const tier of ['tool', 'localhost', 'remote']) {
      expect(timeouts.get(tier)).toBe(30_000);
    }
  });

  it('lets the project seam override the tier timeout', () => {
    const projects = getProjects(defineVitestConfig({ project: { testTimeout: 1_000 } }));

    expect(projects.map((project) => project.test?.testTimeout)).toStrictEqual(PROJECT_NAMES.map(() => 1_000));
  });

  // Neither has a script, so nothing would surface their absence at run time. An undeclared tier's files fall into
  // the residual and run in the default gate, which is the silent failure declaring them prevents.
  it('declares the scriptless tiers, so their files cannot fall into the residual', () => {
    const names = getProjects(defineVitestConfig()).map((project) => project.test?.name);

    expect(names).toContain('localhost');
    expect(names).toContain('remote');
  });

  it('keeps per-project options out of the root test block', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(Object.keys(rootTest).toSorted()).toStrictEqual([
      'coverage',
      'passWithNoTests',
      'projects',
      'silent',
      'watch',
    ]);
  });

  it('carries over the settings the shared config has always applied', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(rootTest.silent).toBe('passed-only');
    expect(rootTest.watch).toBe(false);
    expect(rootTest.coverage?.provider).toBe('v8');
    expect(rootTest.coverage?.enabled).toBe(false);
    expect(rootTest.coverage?.include).toStrictEqual(['**/src/**/*.{ts,tsx}']);
  });

  it('accepts a run that collects no test files', () => {
    expect(defineVitestConfig().test?.passWithNoTests).toBe(true);
  });

  it('lets the root seam turn the empty-run allowance back off', () => {
    const config = defineVitestConfig({ root: { test: { passWithNoTests: false } } });

    expect(config.test?.passWithNoTests).toBe(false);
  });

  it('extends the default exclusions from Vitest rather than replacing them', () => {
    for (const project of getProjects(defineVitestConfig())) {
      expect(project.test?.exclude).toStrictEqual(expect.arrayContaining(['**/node_modules/**', '**/.git/**']));
    }
  });

  it('applies a project override to every project', () => {
    const projects = getProjects(defineVitestConfig({ project: { setupFiles: ['./setup.ts'] } }));

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(PROJECT_NAMES.map(() => ['./setup.ts']));
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

    expect(config.test?.projects).toHaveLength(PROJECT_NAMES.length);
  });
});

describe(defineRootVitestConfig, () => {
  let workspaceRoot: string;
  let singlePackageRoot: string;
  let notARoot: string;

  beforeAll(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'nmr-vitest-workspace-'));
    writeFileSync(
      path.join(workspaceRoot, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n  - 'tools/cli'\n  - '!packages/legacy'\n",
    );
    for (const dir of ['packages/alpha', 'packages/legacy', 'tools/cli']) {
      mkdirSync(path.join(workspaceRoot, dir), { recursive: true });
      writeFileSync(path.join(workspaceRoot, dir, 'package.json'), '{}');
    }

    // A pnpm-10 single-package repo: the manifest exists to carry settings and declares no `packages`.
    singlePackageRoot = mkdtempSync(path.join(tmpdir(), 'nmr-vitest-single-'));
    writeFileSync(path.join(singlePackageRoot, 'pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - esbuild\n');

    notARoot = mkdtempSync(path.join(tmpdir(), 'nmr-vitest-not-a-root-'));
  });

  afterAll(() => {
    for (const dir of [workspaceRoot, singlePackageRoot, notARoot]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('derives one sorted, posix-separated glob per workspace package', () => {
    for (const project of getProjects(defineRootVitestConfig({ monorepoRoot: workspaceRoot }))) {
      expect(project.test?.exclude).toStrictEqual([
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        ...(project.test?.name === 'unit' ? TIERED_PATTERNS : []),
        'packages/alpha/**',
        'tools/cli/**',
      ]);
    }
  });

  it('pins every project to the monorepo root, so the globs resolve from the same base', () => {
    for (const project of getProjects(defineRootVitestConfig({ monorepoRoot: workspaceRoot }))) {
      expect(project.root).toBe(workspaceRoot);
    }
  });

  it('throws a message naming the directory when it holds no workspace manifest', () => {
    expect(() => defineRootVitestConfig({ monorepoRoot: notARoot })).toThrow(
      `Not a monorepo root: no pnpm-workspace.yaml in ${notARoot}`,
    );
  });

  it('throws when given no options at all, which types alone cannot prevent in a JavaScript config', () => {
    // @ts-expect-error -- the argument is required; this is the call a JavaScript consumer can still make.
    expect(() => defineRootVitestConfig()).toThrow('defineRootVitestConfig requires `monorepoRoot`');
  });

  it('throws when given options carrying no monorepo root', () => {
    // @ts-expect-error -- the option is required; a JavaScript consumer can still omit it.
    expect(() => defineRootVitestConfig({})).toThrow('defineRootVitestConfig requires `monorepoRoot`');
  });

  // A relative root reaches `path.join` and `projectRoot` unresolved, so the config would describe whichever
  // monorepo the run started in — the resolution this option replaces.
  it('throws when the monorepo root is not an absolute path', () => {
    for (const monorepoRoot of ['', '.', 'packages/..']) {
      expect(() => defineRootVitestConfig({ monorepoRoot })).toThrow('defineRootVitestConfig requires `monorepoRoot`');
    }
  });

  it('excludes no packages when the manifest declares none, as in a single-package repo', () => {
    for (const project of getProjects(defineRootVitestConfig({ monorepoRoot: singlePackageRoot }))) {
      expect(project.test?.exclude).toStrictEqual([
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        ...(project.test?.name === 'unit' ? TIERED_PATTERNS : []),
      ]);
    }
  });

  it('applies the workspace exclusion to the projects, not the root test block', () => {
    const rootTest = defineRootVitestConfig({ monorepoRoot: workspaceRoot }).test ?? {};

    expect(rootTest).not.toHaveProperty('exclude');
    expect(rootTest).not.toHaveProperty('include');
  });

  it('reports no coverage of its own', () => {
    expect(defineRootVitestConfig({ monorepoRoot: workspaceRoot }).test?.coverage?.include).toStrictEqual([]);
  });

  it('accepts a run that collects no test files', () => {
    expect(defineRootVitestConfig({ monorepoRoot: workspaceRoot }).test?.passWithNoTests).toBe(true);
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

  it.each(['tool', 'localhost', 'remote'])('selects only its own infix for the %s project', (tier) => {
    expect(selectFiles(tier, fixtureRoot)).toStrictEqual([`src/__tests__/thing.${tier}.test.ts`]);
  });

  it('runs a file whose infix matches no tier under the unit project', () => {
    expect(selectFiles('unit', fixtureRoot)).toContain('src/__tests__/thing.smoke.test.ts');
  });

  it('leaves tiered, unnested, and excluded files out of the unit project', () => {
    expect(selectFiles('unit', fixtureRoot)).toStrictEqual([
      'src/__tests__/nested/deep.test.tsx',
      'src/__tests__/plain.test.ts',
      'src/__tests__/thing.smoke.test.ts',
      'src/__tests__/thing.unit.test.ts',
    ]);
  });

  // The residual subtracts the tiers, so an overlap would collect the same file twice and run it twice, green.
  it('claims each file exactly once across the projects', () => {
    const collected = PROJECT_NAMES.flatMap((name) => selectFiles(name, fixtureRoot));

    expect(collected).toStrictEqual([...new Set(collected)]);
  });

  // A copy of the suite under `dist/` runs green against stale code, so no project may collect it.
  it('leaves a test file copied into build output out of every project', () => {
    for (const name of PROJECT_NAMES) {
      expect(selectFiles(name, fixtureRoot)).not.toContain('dist/src/__tests__/copied.test.ts');
    }
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
