import path from 'node:path';

import { captureStdio, createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { runClean } from '../clean.ts';
import { cleanCollecting, hasOutput, scaffoldWorkspace } from '../test-utils/clean-fixtures.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-clean-' })),
);

describe('cleanFrom with a clean override', () => {
  it("runs a package's own clean override from the root instead of sweeping it", async ({ tree }) => {
    // The sweep stands in for a per-package delegation, so a package that overrides `clean` must still get
    // its own command: A package emitting outside `dist` would otherwise be silently under-cleaned.
    const { aDir, bDir } = scaffoldWorkspace(tree);
    writeCleanOverride(tree, aDir, `node --eval "require('fs').writeFileSync('cleaned.txt', '1')"`);

    const { outcome, progress } = await cleanCollecting(tree.dir);

    expect(tree.exists(`${aDir}/cleaned.txt`)).toBe(true);
    expect(hasOutput(tree, aDir)).toBe(true);
    expect(hasOutput(tree, bDir)).toBe(false);
    expect(outcome).toMatchObject({ cleanedDirs: [tree.resolve(aDir), tree.resolve(bDir)], skippedCount: 0 });
    // The override reports for itself, so only the in-process clean is reported as a progress event.
    expect(progress).not.toContainEqual({ kind: 'package-cleaned', packageDir: tree.resolve(aDir) });
  });

  it('fails loudly when a package’s clean override fails', async ({ tree }) => {
    const { aDir } = scaffoldWorkspace(tree);
    writeCleanOverride(tree, aDir, 'exit 3');

    await expect(cleanCollecting(tree.dir)).rejects.toThrow(/exit code 3/);
  });
});

describe(runClean, () => {
  it("prints the report in the order of the sweep, with an override's output in its package's place", async ({
    tree,
  }) => {
    const { aDir } = scaffoldWorkspace(tree);
    writeCleanOverride(tree, aDir, 'echo override-a');
    using captured = captureStdio({ includeConsole: true, isTty: false });

    await expect(runClean([], tree.dir)).resolves.toBe(0);

    expect(captured.stdout).toBe(
      'Removed all recorded check results.\noverride-a\nb: Removed build output and cache.\n\nCleaned 2 packages.\n',
    );
  });

  it('prints the packages cleaned before a failing override, and no closing line', async ({ tree }) => {
    const { bDir } = scaffoldWorkspace(tree);
    writeCleanOverride(tree, bDir, 'exit 3');
    using captured = captureStdio({ includeConsole: true, isTty: false });

    await expect(runClean([], tree.dir)).rejects.toThrow(/`exit 3` failed in b with exit code 3/);

    expect(captured.stdout).toBe('Removed all recorded check results.\na: Removed build output and cache.\n');
  });
});

// region | Helpers

/** Gives the workspace package at `packageEntry` its own `clean` script, named for its directory. */
function writeCleanOverride(tree: TempTree, packageEntry: string, command: string): void {
  tree.write(
    `${packageEntry}/package.json`,
    JSON.stringify({ name: path.basename(packageEntry), type: 'module', scripts: { clean: command } }),
  );
}

// endregion | Helpers
