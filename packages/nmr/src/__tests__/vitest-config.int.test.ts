import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CONFIG_SOURCE = path.join(import.meta.dirname, '../vitest.ts');
const VITEST_CLI = path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs');

/**
 * A package tree whose files sit on either side of every boundary the exclusions draw. Each fixture exists in an
 * imported and an unimported variant: the unimported one reaches coverage through the file glob, the imported one
 * through `isIncluded()`, and only running Vitest exercises both paths at once.
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

  // A build that copies sources rather than compiling them. It passes, which is the point: an unexcluded copy runs
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
 * Runs the shipped config against a real Vitest invocation. The coverage guarantee cannot be asserted from the
 * pattern alone: `isIncluded()` matches absolute paths with picomatch's `contains` flag, whose effect is not
 * visible in the pattern, and a unit test replicating that call would keep passing if Vitest stopped passing it.
 */
describe('the shipped Vitest config, run for real', () => {
  let projectRoot: string;
  let coveredFiles: string[];
  let collectedTestFiles: string[];

  beforeAll(() => {
    projectRoot = scaffoldProject();
    const run = runVitestWithCoverage(projectRoot);

    // Surface the child's own output, or a failure here reads as an unexplained empty result.
    if (run.status !== 0) {
      throw new Error(`fixture run failed with status ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
    }

    coveredFiles = readCoveredFiles(projectRoot);
    collectedTestFiles = readCollectedTestFiles(projectRoot);
  }, 120_000);

  afterAll(() => {
    removeProject(projectRoot);
  });

  it('measures the sources and nothing else', () => {
    expect(coveredFiles).toStrictEqual(['src/covered.ts', 'src/uncovered.ts']);
  });

  it('leaves a source untouched by any test in the report rather than dropping it', () => {
    expect(coveredFiles).toContain('src/uncovered.ts');
  });

  it('excludes a fixture directory under src, whether or not a test imports it', () => {
    expect(coveredFiles).not.toContain('src/__fixtures__/imported.ts');
    expect(coveredFiles).not.toContain('src/__fixtures__/unimported.ts');
  });

  it('excludes a fixture nested under a tests directory, whether or not a test imports it', () => {
    expect(coveredFiles).not.toContain('src/__tests__/fixtures/imported.ts');
    expect(coveredFiles).not.toContain('src/__tests__/fixtures/unimported.ts');
  });

  it('runs the suite once, leaving the copy under build output uncollected', () => {
    expect(collectedTestFiles).toStrictEqual(['src/__tests__/suite.test.ts']);
  });
});

/** Writes the fixture tree and links the repository's `node_modules` so Vitest and its coverage provider resolve. */
function scaffoldProject(): string {
  // Resolve through `realpath`: macOS exposes the temp root through a symlink, while the paths Vitest reports back
  // are resolved, and the two have to agree for the relative paths below to come out right.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-vitest-config-')));

  for (const [relativePath, contents] of Object.entries(PROJECT_FILES)) {
    const absolute = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }

  // pnpm's internal links are relative, so they resolve through the link rather than needing an install here.
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

  return dir;
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

/**
 * Strips the variables the parent Vitest run exports. Inherited, they leak the parent's worker identity and
 * coverage output directory into the child, which then reports on the wrong run.
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('VITEST') || name === 'TEST' || name === 'NODE_V8_COVERAGE') continue;
    env[name] = value;
  }

  return env;
}

/** The files the coverage report measured, relative to the project root. */
function readCoveredFiles(projectRoot: string): string[] {
  const summary = readJson(path.join(projectRoot, 'coverage/coverage-summary.json'));

  return Object.keys(summary)
    .filter((key) => key !== 'total')
    .map((absolute) => toRelativePosix(projectRoot, absolute))
    .toSorted();
}

/** The test files the run collected, relative to the project root. */
function readCollectedTestFiles(projectRoot: string): string[] {
  const results = readJson(path.join(projectRoot, 'results.json'));
  const testResults: unknown = results.testResults;

  if (!Array.isArray(testResults)) {
    throw new TypeError('the JSON reporter wrote no testResults array');
  }

  return testResults
    .map((result: unknown) => {
      if (typeof result !== 'object' || result === null || !('name' in result) || typeof result.name !== 'string') {
        throw new TypeError('a testResults entry named no file');
      }
      return toRelativePosix(projectRoot, result.name);
    })
    .toSorted();
}

function readJson(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError(`expected an object in ${filePath}`);
  }

  return parsed as Record<string, unknown>;
}

function toRelativePosix(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}

/** Unlinks `node_modules` before the recursive delete, so no failure mode can reach the repository's own tree. */
function removeProject(projectRoot: string): void {
  const link = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(link)) fs.unlinkSync(link);

  fs.rmSync(projectRoot, { recursive: true, force: true });
}
