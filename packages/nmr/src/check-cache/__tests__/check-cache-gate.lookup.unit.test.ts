import path from 'node:path';

import { assert, describe, expect } from 'vitest';

import {
  COMMAND,
  it,
  readEntry,
  stubTree,
  writeBuildDigest,
  writeConfig,
} from '../../test-utils/check-cache-gate-fixtures.ts';
import { writeCheckCacheEntry } from '../check-cache-entries.ts';

const DEBUG_ENV = { NMR_DEBUG: '1' };

describe('the check-result cache gate', () => {
  describe('a recorded pass that covers the invocation', () => {
    it('skips the run, naming the scope, the command, and the tree', async ({ nmr, repo }) => {
      await nmr.run([COMMAND], repo);

      const { exitCode, stdout } = await nmr.runReadingStdout([COMMAND], repo);

      expect(exitCode).toBe(0);
      expect(nmr.runSteps).toHaveBeenCalledTimes(1);
      expect(stdout).toContain(`SKIP ${path.basename(repo)}: ${COMMAND}:`);
      expect(stdout).toContain('on this tree');
    });

    it('reports the skip under -q, which withholds the command output and not the verdict', async ({ nmr, repo }) => {
      await nmr.run([COMMAND], repo);

      const { stdout } = await nmr.runReadingStdout(['-q', COMMAND], repo);

      expect(nmr.runSteps).toHaveBeenCalledTimes(1);
      expect(stdout).toContain(`SKIP ${path.basename(repo)}: ${COMMAND}:`);
    });

    it('skips at the root a command recorded at the root and asked from a subdirectory', async ({ nmr, repo }) => {
      await nmr.run([COMMAND], repo);

      const { exitCode } = await nmr.run([COMMAND], path.join(repo, 'tools'));

      expect(exitCode).toBe(0);
      expect(nmr.runSteps).toHaveBeenCalledTimes(1);
    });

    // The warning belongs to the command's shape, so a command that usually skips would otherwise almost never
    // report it.
    it('warns about a shelled nmr step although the run skipped', async ({ nmr, repo, workspace }) => {
      writeConfig(workspace, workspace.resolve('log.txt'), { command: 'nmr ok' });
      await nmr.run([COMMAND], repo);

      const { stderr } = await nmr.runReadingStderr([COMMAND], repo);

      expect(nmr.runSteps).toHaveBeenCalledTimes(1);
      expect(stderr).toContain('reaches nmr through a shell (`nmr ok`)');
    });
  });

  describe('a miss', () => {
    it('runs, and says that no pass is recorded, when the scope has no entry', async ({ nmr, repo }) => {
      const { stderr } = await nmr.runReadingStderr([COMMAND], repo, DEBUG_ENV);

      expect(nmr.runSteps).toHaveBeenCalledTimes(1);
      expect(stderr).toContain('no pass recorded');
    });

    it('runs again when the tree differs from the one that the pass was earned on', async ({ nmr, repo }) => {
      await nmr.run([COMMAND], repo);
      stubTree(nmr, repo, 'tree-2');

      const { stderr } = await nmr.runReadingStderr([COMMAND], repo, DEBUG_ENV);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
      expect(stderr).toContain('the tree or its inputs changed');
    });

    it('runs here when the pass was earned on a host that the invocation does not target', async ({ nmr, repo }) => {
      await nmr.run([COMMAND], repo);
      const entry = await readEntry(repo);
      assert.ok(entry !== undefined);
      await writeCheckCacheEntry({
        anchorDir: repo,
        command: COMMAND,
        entry: { ...entry, host: 'imac' },
        monorepoRoot: repo,
      });

      const { stderr } = await nmr.runReadingStderr([COMMAND], repo, DEBUG_ENV);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
      expect(stderr).toContain('the last pass was earned on imac');
    });
  });

  // Build output is git-ignored, so the tree hash does not see it change: The gate reads it on its own.
  describe('build output that the tree hash cannot see', () => {
    it.for([
      {
        alter: 'removed',
        expectedNote: `running ${COMMAND}: packages/a does not have build output`,
      },
      {
        alter: 'rebuilt from another tree',
        expectedNote: `running ${COMMAND}: packages/a's build output came from a different tree`,
      },
    ] as const)('runs again when the output was $alter', async ({ alter, expectedNote }, { nmr, repo, workspace }) => {
      await nmr.run([COMMAND], repo);
      alterBuildOutput(workspace, alter);

      const { stderr } = await nmr.runReadingStderr([COMMAND], repo, DEBUG_ENV);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
      expect(stderr).toContain(expectedNote);
    });

    it('settles once it has run against the output on disk', async ({ nmr, repo, workspace }) => {
      await nmr.run([COMMAND], repo);
      alterBuildOutput(workspace, 'rebuilt from another tree');
      await nmr.run([COMMAND], repo);

      await nmr.run([COMMAND], repo);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
    });

    it('skips again once the missing output is back', async ({ nmr, repo, workspace }) => {
      await nmr.run([COMMAND], repo);
      alterBuildOutput(workspace, 'removed');
      await nmr.run([COMMAND], repo);

      workspace.write('repo/packages/a/dist/esm/index.js', 'export const value = 1;\n');
      await nmr.run([COMMAND], repo);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
    });
  });
});

// region | Helpers

/** Removes the fixture package's build output, or replaces its digest with one that another tree left. */
function alterBuildOutput(
  workspace: Parameters<typeof writeBuildDigest>[0],
  alter: 'rebuilt from another tree' | 'removed',
): void {
  if (alter === 'removed') {
    workspace.rm('repo/packages/a/dist');
    return;
  }
  writeBuildDigest(workspace, 'repo/packages/a', 'digest-from-another-tree');
}

// endregion | Helpers
