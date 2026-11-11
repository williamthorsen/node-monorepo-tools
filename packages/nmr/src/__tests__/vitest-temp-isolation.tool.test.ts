import path from 'node:path';

import { isRecord } from '@williamthorsen/nmr-core';
import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { runVitest, scaffoldProject, unlinkNodeModules } from '../test-utils/vitest-run.ts';

const CONFIG_SOURCE = path.join(import.meta.dirname, '../vitest.ts');

/**
 * A project whose tests record the temp directory that they and a child process resolve, and leave a file there
 * without cleaning up. One of the tests fails, because teardown must remove the run directory either way.
 */
const TEMP_ISOLATION_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'vitest-temp-isolation', private: true, type: 'module' }),
  'vitest.config.ts': buildConfigSource(''),
  'vitest.optout.config.ts': buildConfigSource('{ shouldIsolateTempDir: false }'),
  'src/__tests__/passing.unit.test.ts': buildRecordingTest('passing', 'expect(true).toBe(true);'),
  'src/__tests__/failing.unit.test.ts': buildRecordingTest('failing', 'expect(true).toBe(false);'),
};

// The builder owns both trees through a `DisposableStack` and transfers them only past the last statement that can
// throw. `createTempTree` resolves through `realpath`, so the base directory compares equal to the realpaths that
// the recording tests report.

const it = baseIt
  // eslint-disable-next-line no-empty-pattern -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern.
  .extend('tempIsolation', { scope: 'file' }, ({}, { onCleanup }) => {
    using stack = new DisposableStack();
    const tree = stack.use(createTempTree({}, { prefix: 'nmr-vitest-temp-isolation-' }));
    const base = stack.use(createTempTree({}, { prefix: 'nmr-vitest-temp-base-' }));
    scaffoldProject(tree, TEMP_ISOLATION_FILES);
    stack.defer(() => unlinkNodeModules(tree.dir));

    const isolatedRun = runVitest(tree.dir, [], { TMPDIR: base.dir });
    const isolated = {
      baseEntriesAfterRun: base.list(),
      failing: tree.readJson('observed-failing.json'),
      passing: tree.readJson('observed-passing.json'),
      status: isolatedRun.status,
    };
    runVitest(tree.dir, ['--config', 'vitest.optout.config.ts'], { TMPDIR: base.dir });
    const optedOut = tree.readJson('observed-passing.json');

    const ownedStack = stack.move();
    onCleanup(() => {
      ownedStack.dispose();
    });

    return { baseDir: base.dir, isolated, optedOut };
  });

describe('temp-directory isolation, run for real', { timeout: 120_000 }, () => {
  it('resolves the temp directory inside one run directory, in a test and in a process that it spawns', ({
    tempIsolation,
  }) => {
    const { failing, passing } = tempIsolation.isolated;
    const runDir = readTempDir(passing);

    expect(path.dirname(runDir)).toBe(tempIsolation.baseDir);
    expect(path.basename(runDir)).toMatch(/^nmr-vitest-\d+-./);
    expect([passing, failing]).toStrictEqual([
      { child: runDir, test: runDir },
      { child: runDir, test: runDir },
    ]);
  });

  // The failing test is what makes the run exit non-zero, which shows that teardown ran after a failure.
  it('leaves no new entries in the temp directory, although a test failed', ({ tempIsolation }) => {
    expect(tempIsolation.isolated.status).toBe(1);
    expect(tempIsolation.isolated.baseEntriesAfterRun).toStrictEqual([]);
  });

  it('resolves the ambient temp directory when shouldIsolateTempDir is off', ({ tempIsolation }) => {
    expect(tempIsolation.optedOut).toStrictEqual({ child: tempIsolation.baseDir, test: tempIsolation.baseDir });
  });
});

// region | Helpers

/** Builds a config file that calls the factory from source, so that the test does not need a build. */
function buildConfigSource(options: string): string {
  return `import { defineVitestConfig } from ${JSON.stringify(CONFIG_SOURCE)};\n\nexport default defineVitestConfig(${options});\n`;
}

/**
 * Builds a test that records, in `observed-<name>.json`, the realpath of the temp directory that it and a spawned
 * `node` resolve, leaves a file in that directory, and ends with `assertion`.
 */
function buildRecordingTest(name: string, assertion: string): string {
  return [
    "import { execFileSync } from 'node:child_process';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { expect, it } from 'vitest';",
    '',
    "it('records its temp directory', () => {",
    "  const child = execFileSync(process.execPath, ['-p', 'require(\"node:os\").tmpdir()'], { encoding: 'utf8' }).trim();",
    '  const observed = { child: fs.realpathSync(child), test: fs.realpathSync(os.tmpdir()) };',
    `  fs.writeFileSync(path.join(os.tmpdir(), 'left-by-${name}.txt'), '');`,
    `  fs.writeFileSync('observed-${name}.json', JSON.stringify(observed));`,
    `  ${assertion}`,
    '});',
    '',
  ].join('\n');
}

/** Reads the temp directory that a recording test observed in its own process. */
function readTempDir(observed: unknown): string {
  if (isRecord(observed) && typeof observed['test'] === 'string') return observed['test'];

  throw new Error(`expected a recorded temp directory, got ${JSON.stringify(observed)}`);
}

// endregion | Helpers
