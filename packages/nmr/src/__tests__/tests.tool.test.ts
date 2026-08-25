import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { runVitest, scaffoldProject, unlinkNodeModules } from '../test-utils/vitest-run.ts';

const CHECK_SOURCE = path.join(import.meta.dirname, '../tests.ts');
const CONFIG_SOURCE = path.join(import.meta.dirname, '../vitest.ts');

/**
 * A repo carrying the guard, one violation of each half, and a generated directory holding one of each that the
 * guard's `exclude` and the config's `testCollectionExclude` together keep out of scope.
 *
 * Both are imported from source rather than from `dist`, so the test needs no build.
 */
const REPO_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'conventions-fixture', private: true, type: 'module' }),

  // What the guard's default root resolution walks up to find. It stops at the first directory holding one, so the
  // sweep is scoped to the fixture rather than to the repo this suite runs in.
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",

  'vitest.config.ts': [
    `import { defineVitestConfig } from ${JSON.stringify(CONFIG_SOURCE)};`,
    '',
    "export default defineVitestConfig({ testCollectionExclude: ['generated'] });",
    '',
  ].join('\n'),

  // The one-line wiring a consuming repo carries, naming its own tier so a misnamed guard reports itself.
  '__tests__/conventions.unit.test.ts': [
    `import { checkTestFileConventions } from ${JSON.stringify(CHECK_SOURCE)};`,
    '',
    "checkTestFileConventions({ exclude: ['generated'] });",
    '',
  ].join('\n'),

  'generated/__tests__/scaffold.test.ts': buildPassingTest(), // untiered, in the directory both exclusions name
  'generated/scaffold.unit.test.ts': buildPassingTest(), // misplaced, in that same directory
  'src/__tests__/plain.unit.test.ts': buildPassingTest(), // conformant, so the run's only failures are the guard's
  'src/__tests__/untiered.test.ts': buildPassingTest(), // collected, and its name selects no tier
  'src/outside.unit.test.ts': buildPassingTest(), // collected by nothing, so only the sweep can report it
};

// The tree is owned through a `DisposableStack` and transferred only past the last statement that can throw.
// A failing child run is what this fixture is built to observe, so it is reported rather than thrown on.
// eslint-disable-next-line no-empty-pattern, vitest/consistent-test-it -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern, and the rule reads this builder call as a top-level test.
const it = baseIt.extend('run', { scope: 'file' }, ({}, { onCleanup }) => {
  using stack = new DisposableStack();
  const tree = stack.use(createTempTree({}, { prefix: 'nmr-conventions-repo-' }));
  scaffoldProject(tree, REPO_FILES);
  stack.defer(() => unlinkNodeModules(tree.dir));

  const run = runVitest(tree.dir);
  const owned = stack.move();
  onCleanup(() => {
    owned.dispose();
  });

  return { output: `${run.stdout}${run.stderr}`, status: run.status };
});

/**
 * Runs the published check the way a consuming repo wires it. Nothing short of a real run settles this: a guard
 * sweeping the wrong root finds nothing and passes, which is the same green as a conformant repo's.
 */
// The block's budget rather than the hook's: a file-scoped fixture is built inside the first test that names it,
// where `testTimeout` governs and the tier's 30 seconds will not cover a real Vitest run.
describe('the exported conventions check, wired into a real run', { timeout: 120_000 }, () => {
  it('fails the run it is wired into', ({ run }) => {
    expect(run.status).not.toBe(0);
  });

  it('names the untiered file, and the tiers that would fix it', ({ run }) => {
    expect(run.output).toContain('src/__tests__/untiered.test.ts');
    expect(run.output).toContain('unit, tool, localhost, remote');
  });

  it('names the file sitting outside a tests directory, and where it belongs', ({ run }) => {
    expect(run.output).toContain('src/outside.unit.test.ts');
    expect(run.output).toContain('__tests__');
  });

  // The guard's `exclude` and the config's `testCollectionExclude` describe one scope, so a directory named in both
  // is neither collected nor reported. Named in the sweep alone, its files would still run.
  it('reports nothing from the directory both exclusions name', ({ run }) => {
    expect(run.output).not.toContain('generated/__tests__/scaffold.test.ts');
    expect(run.output).not.toContain('generated/scaffold.unit.test.ts');
  });
});

/** A test file that passes, so every failure the run reports is the guard's. */
function buildPassingTest(): string {
  return [
    "import { expect, it } from 'vitest';",
    '',
    "it('passes', () => {",
    '  expect(true).toBe(true);',
    '});',
    '',
  ].join('\n');
}
