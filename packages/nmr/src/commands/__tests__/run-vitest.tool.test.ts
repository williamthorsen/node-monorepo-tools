import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { runNmrVitestCli, scaffoldProject, unlinkNodeModules } from '../../test-utils/vitest-run.ts';

const CONFIG_SOURCE = path.join(import.meta.dirname, '../../vitest.ts');

/** A monorepo whose only Vitest config is the root one, and two packages that each have one passing test. */
const REPO_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'nmr-vitest-fixture', private: true, type: 'module' }),
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
  'vitest.config.ts': [
    `import { defineVitestConfig } from ${JSON.stringify(CONFIG_SOURCE)};`,
    '',
    'export default defineVitestConfig();',
    '',
  ].join('\n'),
  'packages/a/package.json': JSON.stringify({ name: 'a', private: true, type: 'module' }),
  'packages/a/src/__tests__/alpha.unit.test.ts': buildPassingTest(),
  'packages/b/package.json': JSON.stringify({ name: 'b', private: true, type: 'module' }),
  'packages/b/src/__tests__/beta.unit.test.ts': buildPassingTest(),
};

// eslint-disable-next-line no-empty-pattern, vitest/consistent-test-it -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern, and the rule reads this builder call as a top-level test.
const it = baseIt.extend('run', { scope: 'file' }, ({}, { onCleanup }) => {
  using stack = new DisposableStack();
  const tree = stack.use(createTempTree({}, { prefix: 'nmr-vitest-repo-' }));
  scaffoldProject(tree, REPO_FILES);
  stack.defer(() => unlinkNodeModules(tree.dir));

  // A tier filter fails with `No projects matched the filter` unless the run loads the root config.
  const run = runNmrVitestCli(tree.resolve('packages/a'), ['run', '--project', 'unit', '--reporter=verbose']);
  const ownedStack = stack.move();
  onCleanup(() => {
    ownedStack.dispose();
  });

  return { output: `${run.stdout}${run.stderr}`, status: run.status };
});

// The block's budget rather than the hook's: A file-scoped fixture is built inside the first test that names it,
// so `testTimeout` applies to it, and the tier's 30 seconds will not cover a real Vitest run.
describe('nmr-vitest in a package without a config of its own', { timeout: 120_000 }, () => {
  it('runs the tier projects of the root config', ({ run }) => {
    expect(run.output).not.toContain('No projects matched');
    expect(run.status).toBe(0);
  });

  it("collects the package's own tests alone", ({ run }) => {
    expect(run.output).toContain('alpha.unit.test.ts');
    expect(run.output).not.toContain('beta.unit.test.ts');
  });
});

describe('nmr-vitest without a resolvable vitest', () => {
  baseIt('names the vitest peer and fails', () => {
    using tree = createTempTree({ 'package.json': '{}\n' }, { prefix: 'nmr-vitest-bare-' });

    // pnpm points NODE_PATH at the repo's store, through which the child would otherwise resolve this repo's copy.
    const run = runNmrVitestCli(tree.dir, ['run'], { NODE_PATH: undefined });

    expect(run.stderr).toContain('nmr-vitest: requires Vitest >=4.0.0 <6');
    expect(run.status).toBe(1);
  });
});

// region | Helpers

/** Returns the source of a test file that passes. */
function buildPassingTest(): string {
  return "import { expect, it } from 'vitest';\n\nit('passes', () => {\n  expect(true).toBe(true);\n});\n";
}

// endregion | Helpers
