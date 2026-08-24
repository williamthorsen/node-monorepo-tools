import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { describe, expect, it as baseIt } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CONFIG_SOURCE = path.join(import.meta.dirname, '../vitest.ts');
const VITEST_CLI = path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs');
const SETUP_LOG = 'setup-order.log';
const OBSERVED_LOG = 'observed.json';

/**
 * A package tree whose files sit on either side of every boundary the exclusions draw.
 * Each fixture exists in an imported and an unimported variant: the unimported one reaches coverage through the
 * file glob, the imported one through `isIncluded()`, and only running Vitest exercises both paths at once.
 */
const PROJECT_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'vitest-config-fixture', private: true, type: 'module' }),

  // The config under test, imported from source rather than from `dist`, so the test needs no build.
  'vitest.config.ts': `import { defineVitestConfig } from ${JSON.stringify(CONFIG_SOURCE)};\n\nexport default defineVitestConfig();\n`,

  'src/covered.ts': 'export const covered = (): string => "covered";\n',
  'src/uncovered.ts': 'export const uncovered = (): string => "uncovered";\n',
  'src/__fixtures__/imported.ts': 'export const importedFixture = "imported";\n',
  'src/__fixtures__/unimported.ts': 'export const unimportedFixture = "unimported";\n',
  'src/__tests__/fixtures/imported.ts': 'export const importedNestedFixture = "imported";\n',
  'src/__tests__/fixtures/unimported.ts': 'export const unimportedNestedFixture = "unimported";\n',

  'src/__tests__/suite.test.ts': [
    "import { expect, it } from 'vitest';",
    '',
    "import { importedFixture } from '../__fixtures__/imported.ts';",
    "import { covered } from '../covered.ts';",
    "import { importedNestedFixture } from './fixtures/imported.ts';",
    '',
    "it('loads the covered source and both imported fixtures', () => {",
    '  expect([covered(), importedFixture, importedNestedFixture]).toHaveLength(3);',
    '});',
    '',
  ].join('\n'),

  // A build that copies sources rather than compiling them. It passes, which is the point: An unexcluded copy runs
  // green against stale code, so the collected file list is the only thing that can detect it.
  'dist/src/__tests__/suite.test.ts': [
    "import { expect, it } from 'vitest';",
    '',
    "it('passes green from build output', () => {",
    '  expect(true).toBe(true);',
    '});',
    '',
  ].join('\n'),
};

/**
 * A package whose config composes two option layers, each contributing a setup file that records when it ran.
 * Only a real run settles the order: the config object shows the array, not which entry Vitest executes first.
 */
/**
 * A tree whose dependency reports which export condition selected it, alongside the two configs that decide.
 *
 * The dependency is reached through a symlink whose target sits outside any `node_modules`: Vite hands a real
 * `node_modules` dependency to Node's resolver, which never consults `resolve.conditions`, and inlines a linked
 * one, which is why the condition reaches a workspace package at all.
 */
const DEFAULTS_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'vitest-defaults-fixture', private: true, type: 'module' }),

  'vitest.config.ts': `import { defineVitestConfig } from ${JSON.stringify(CONFIG_SOURCE)};\n\nexport default defineVitestConfig();\n`,

  'vitest.optout.config.ts': [
    `import { defineVitestConfig } from ${JSON.stringify(CONFIG_SOURCE)};`,
    '',
    'export default defineVitestConfig({ isolateGit: false, resolveFromSource: false });',
    '',
  ].join('\n'),

  // Each entry names the condition that selected it, so a dropped `node` is distinguishable from a dropped `source`.
  'dependency/package.json': JSON.stringify({
    name: '@fixture/dep',
    private: true,
    type: 'module',
    exports: {
      '.': {
        source: './src/index.ts',
        browser: './dist/browser.js',
        node: './dist/node.js',
        default: './dist/default.js',
      },
    },
  }),
  'dependency/src/index.ts': 'export const entry = "source";\n',
  'dependency/dist/browser.js': 'export const entry = "browser";\n',
  'dependency/dist/default.js': 'export const entry = "default";\n',
  'dependency/dist/node.js': 'export const entry = "node";\n',

  'src/__tests__/defaults.test.ts': [
    "import { writeFileSync } from 'node:fs';",
    '',
    "import { expect, it } from 'vitest';",
    '',
    "import { entry } from '@fixture/dep';",
    '',
    "it('records the entry it resolved and the git configuration it inherited', () => {",
    `  writeFileSync(`,
    `    new URL(${JSON.stringify(`../../${OBSERVED_LOG}`)}, import.meta.url),`,
    '    JSON.stringify({',
    '      entry,',
    '      gitConfigGlobal: process.env.GIT_CONFIG_GLOBAL,',
    '      gitConfigNoSystem: process.env.GIT_CONFIG_NOSYSTEM,',
    '      gitConfigSystem: process.env.GIT_CONFIG_SYSTEM,',
    '    }),',
    '  );',
    '  expect(entry).toBeTypeOf("string");',
    '});',
    '',
  ].join('\n'),
};

const LAYER_ORDER_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'vitest-layer-fixture', private: true, type: 'module' }),

  'vitest.config.ts': [
    `import { defineVitestConfig } from ${JSON.stringify(CONFIG_SOURCE)};`,
    '',
    'export default defineVitestConfig(',
    "  { project: { setupFiles: ['./shared-setup.ts'] } },",
    "  { project: { setupFiles: ['./package-setup.ts'] } },",
    ');',
    '',
  ].join('\n'),

  'shared-setup.ts': buildSetupFile('shared'),
  'package-setup.ts': buildSetupFile('package'),

  'src/__tests__/suite.test.ts': [
    "import { expect, it } from 'vitest';",
    '',
    "it('runs once both setup files have', () => {",
    '  expect(true).toBe(true);',
    '});',
    '',
  ].join('\n'),
};

// Each builder owns its tree through a `DisposableStack` and transfers it only past the last statement that can
// throw: a fixture that fails never reaches its `onCleanup` registration, and both of these throw by design when
// the child run does. `createTempTree` resolves through `realpath`, which the relative paths below depend on,
// because macOS exposes the temp root through a symlink while Vitest reports resolved paths back.
const it = baseIt
  // eslint-disable-next-line no-empty-pattern -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern.
  .extend('project', { scope: 'file' }, ({}, { onCleanup }) => {
    using stack = new DisposableStack();
    const tree = stack.use(createTempTree({}, { prefix: 'nmr-vitest-config-' }));
    scaffoldProject(tree, PROJECT_FILES);
    stack.defer(() => unlinkNodeModules(tree.dir));

    const run = runVitestWithCoverage(tree.dir);

    // Surface the child's own output, or a failure here reads as an unexplained empty result.
    if (run.status !== 0) {
      throw new Error(`fixture run failed with status ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
    }

    const derived = {
      collectedTestFiles: readCollectedTestFiles(tree),
      coveredFiles: readCoveredFiles(tree),
    };
    const owned = stack.move();
    onCleanup(() => {
      owned.dispose();
    });

    return derived;
  })
  // eslint-disable-next-line no-empty-pattern -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern.
  .extend('defaults', { scope: 'file' }, ({}, { onCleanup }) => {
    using stack = new DisposableStack();
    const tree = stack.use(createTempTree({}, { prefix: 'nmr-vitest-defaults-' }));
    scaffoldProject(tree, DEFAULTS_FILES);
    // Relative, so the link resolves through the tree rather than through the path this process happens to hold.
    tree.symlink('src/node_modules/@fixture/dep', '../../../dependency');
    stack.defer(() => unlinkNodeModules(tree.dir));

    const derived = {
      optedOut: readObserved(tree, runVitest(tree.dir, ['--config', 'vitest.optout.config.ts'])),
      supplied: readObserved(tree, runVitest(tree.dir)),
    };
    const owned = stack.move();
    onCleanup(() => {
      owned.dispose();
    });

    return derived;
  })
  // eslint-disable-next-line no-empty-pattern -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern.
  .extend('layers', { scope: 'file' }, ({}, { onCleanup }) => {
    using stack = new DisposableStack();
    const tree = stack.use(createTempTree({}, { prefix: 'nmr-vitest-layers-' }));
    scaffoldProject(tree, LAYER_ORDER_FILES);
    stack.defer(() => unlinkNodeModules(tree.dir));

    const run = runVitest(tree.dir);

    if (run.status !== 0) {
      throw new Error(`fixture run failed with status ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
    }

    const setupOrder = tree.read(SETUP_LOG).split('\n').filter(Boolean);
    const owned = stack.move();
    onCleanup(() => {
      owned.dispose();
    });

    return { setupOrder };
  });

/**
 * Runs the shipped config against a real Vitest invocation. The coverage guarantee cannot be asserted from the
 * pattern alone: `isIncluded()` matches absolute paths with picomatch's `contains` flag, whose effect is not
 * visible in the pattern, and a unit test replicating that call would keep passing if Vitest stopped passing it.
 */
// The block's budget rather than the hook's: a file-scoped fixture is built inside the first test that names it,
// where `testTimeout` governs and the tier's 30 seconds will not cover a real Vitest run.
describe('the shipped Vitest config, run for real', { timeout: 120_000 }, () => {
  // `src/uncovered.ts` appearing here also proves a source untouched by any test is reported rather than dropped.
  it('measures the sources and nothing else', ({ project }) => {
    expect(project.coveredFiles).toStrictEqual(['src/covered.ts', 'src/uncovered.ts']);
  });

  it('excludes a fixture directory under src, whether or not a test imports it', ({ project }) => {
    expect(project.coveredFiles).not.toContain('src/__fixtures__/imported.ts');
    expect(project.coveredFiles).not.toContain('src/__fixtures__/unimported.ts');
  });

  it('excludes a fixture nested under a tests directory, whether or not a test imports it', ({ project }) => {
    expect(project.coveredFiles).not.toContain('src/__tests__/fixtures/imported.ts');
    expect(project.coveredFiles).not.toContain('src/__tests__/fixtures/unimported.ts');
  });

  it('runs the suite once, leaving the copy under build output uncollected', ({ project }) => {
    expect(project.collectedTestFiles).toStrictEqual(['src/__tests__/suite.test.ts']);
  });
});

describe('composed option layers, run for real', { timeout: 120_000 }, () => {
  // A shared entry establishes the environment the later ones run in, so the order is the guarantee rather than
  // the membership. Asserting on the config object would pass even if Vitest executed the two the other way round.
  it('runs an earlier layer of setup files before a later one', ({ layers }) => {
    expect(layers.setupOrder.map((entry) => entry.split(':', 1)[0])).toStrictEqual(['shared', 'package']);
  });

  // nmr's own setup file writes nothing to this log, so what the first layer observed is the evidence it ran.
  it('isolates git before the first setup file a layer supplies', ({ layers }) => {
    expect(layers.setupOrder[0]).toBe('shared:isolated');
  });
});

describe('the defaults the factory supplies, run for real', { timeout: 120_000 }, () => {
  // Both halves matter: `source` selects the source entry, and Vite's own `node` default survives alongside it.
  // Emitting `source` alone would replace that default and resolve the browser entry inside this node run.
  it('resolves a linked dependency through its source condition', ({ defaults }) => {
    expect(defaults.supplied).toMatchObject({ entry: 'source' });
  });

  it('isolates git in the test process', ({ defaults }) => {
    expect(defaults.supplied).toMatchObject({
      gitConfigGlobal: os.devNull,
      gitConfigNoSystem: '1',
      gitConfigSystem: os.devNull,
    });
  });

  // The condition is what selects the source entry, rather than anything incidental about the fixture: without it
  // the same tree resolves the `node` entry, which is also what proves `node` was in the emitted list.
  //
  // The report carries `entry` alone because an unset variable serializes to no key at all, so the absent three
  // are the assertion that nothing set them.
  it('falls back to the node entry and the ambient git configuration when both defaults are off', ({ defaults }) => {
    expect(defaults.optedOut).toStrictEqual({ entry: 'node' });
  });
});

/** Writes the fixture files into `tree` and links the repository's `node_modules` so Vitest and its coverage provider resolve. */
function scaffoldProject(tree: TempTree, files: Record<string, string>): void {
  tree.writeAll(files);

  // pnpm's internal links are relative, so they resolve through the link rather than needing an install here.
  tree.symlink('node_modules', path.join(REPO_ROOT, 'node_modules'));
}

function runVitestWithCoverage(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const args = [
    VITEST_CLI,
    'run',
    '--coverage',
    '--coverage.reporter=json-summary',
    '--coverage.reportsDirectory=coverage',
    '--reporter=json',
    '--outputFile=results.json',
  ];

  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: buildChildEnv() });
}

function runVitest(cwd: string, extraArgs: string[] = []): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [VITEST_CLI, 'run', ...extraArgs], {
    cwd,
    encoding: 'utf8',
    env: buildChildEnv(),
  });
}

/**
 * A setup file that appends its own name to a log beside itself, so the run records the order the two ran in.
 * The name carries whether git isolation was already in place, which is the only evidence that nmr's own setup
 * file ran ahead of the layers': it declares no entry in this log of its own.
 */
function buildSetupFile(name: string): string {
  return [
    "import { appendFileSync } from 'node:fs';",
    '',
    `const state = process.env.GIT_CONFIG_GLOBAL === undefined ? 'bare' : 'isolated';`,
    `appendFileSync(new URL(${JSON.stringify(SETUP_LOG)}, import.meta.url), \`${name}:\${state}\\n\`);`,
    '',
  ].join('\n');
}

/**
 * Strips the variables the parent Vitest run exports. Inherited, they leak the parent's worker identity and
 * coverage output directory into the child, which then reports on the wrong run.
 *
 * `GIT_CONFIG_*` is stripped for the same reason: this repo's own suite runs under the isolation the config
 * supplies, so a child inheriting it observes isolation whether or not the config under test asked for any.
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (name === 'TEST' || name === 'NODE_V8_COVERAGE') continue;
    if (name.startsWith('VITEST') || name.startsWith('GIT_CONFIG_')) continue;
    env[name] = value;
  }

  return env;
}

/** One fixture run's report, after failing loudly with the child's own output where the run did not succeed. */
function readObserved(tree: TempTree, run: { status: number | null; stdout: string; stderr: string }): unknown {
  if (run.status !== 0) {
    throw new Error(`fixture run failed with status ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
  }

  return tree.readJson(OBSERVED_LOG);
}

/** The files the coverage report measured, relative to the project root. Its keys are absolute paths. */
function readCoveredFiles(tree: TempTree): string[] {
  const summary = readJsonObject(tree, 'coverage/coverage-summary.json');

  return Object.keys(summary)
    .filter((key) => key !== 'total')
    .map((absolute) => toRelativePosix(tree.dir, absolute))
    .toSorted();
}

/** The test files the run collected, relative to the project root. */
function readCollectedTestFiles(tree: TempTree): string[] {
  const results = readJsonObject(tree, 'results.json');
  const testResults: unknown = 'testResults' in results ? results.testResults : undefined;

  if (!Array.isArray(testResults)) {
    throw new TypeError('the JSON reporter wrote no testResults array');
  }

  return testResults.map((result: unknown) => toRelativePosix(tree.dir, readTestFileName(result))).toSorted();
}

/** The `name` of one JSON-reporter result, which holds the absolute path of the test file it ran. */
function readTestFileName(result: unknown): string {
  if (result === null || typeof result !== 'object' || !('name' in result) || typeof result.name !== 'string') {
    throw new TypeError('a testResults entry named no file');
  }

  return result.name;
}

function readJsonObject(tree: TempTree, entryPath: string): object {
  const parsed: unknown = tree.readJson(entryPath);

  if (parsed === null || typeof parsed !== 'object') {
    throw new TypeError(`expected a JSON object in ${entryPath}`);
  }

  return parsed;
}

function toRelativePosix(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}

/**
 * Unlinks `node_modules`, which is deferred ahead of the tree's own removal so no failure mode can reach the
 * repository's own tree. `node:fs`, because `tree.rm` removes with `force`: were this entry ever a real
 * directory rather than the link, it would go silently where `unlinkSync` throws.
 */
function unlinkNodeModules(projectRoot: string): void {
  const link = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(link)) fs.unlinkSync(link);
}
