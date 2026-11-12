import path from 'node:path';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect } from 'vitest';

import {
  COMMAND,
  countCacheEntries,
  it,
  stubTree,
  writeBuildDigest,
} from '../../test-utils/check-cache-gate-fixtures.ts';

const DEBUG_ENV = { NMR_DEBUG: '1' };

describe('the check-result cache gate', () => {
  describe('what is never recorded', () => {
    it('does not record a failing run', async ({ nmr, repo, workspace }) => {
      nmr.runSteps.mockResolvedValue({ exitCode: 3 });

      const { exitCode } = await nmr.run([COMMAND], repo);

      expect(exitCode).toBe(3);
      expect(countCacheEntries(workspace)).toBe(0);
    });

    // A check that rewrites a file describes a tree that no longer exists by the time it finishes.
    it('does not record a run that changed the tree about which it was asked', async ({ nmr, repo, workspace }) => {
      nmr.runSteps.mockImplementation(() => {
        stubTree(nmr, repo, 'tree-2');
        return Promise.resolve({ exitCode: 0 });
      });

      const { stderr } = await nmr.runReadingStderr([COMMAND], repo, DEBUG_ENV);

      expect(countCacheEntries(workspace)).toBe(0);
      expect(stderr).toContain('the tree changed while it ran');
    });
  });

  // The build cache is under gitignored `node_modules/`, so a rebuild does not change the tree hash: The comparison
  // of the reads before and after the run is the only thing that can catch it.
  describe('build output that moves while the check runs', () => {
    it.for([
      {
        case: 'a covered package’s digest changes',
        prepare: (): void => {},
        run: (workspace: TempTree): void => {
          writeBuildDigest(workspace, 'repo/packages/a', 'digest-from-a-concurrent-build');
        },
      },
      {
        case: 'the run itself builds output that was absent',
        prepare: (workspace: TempTree): void => {
          workspace.rm('repo/packages/a/dist');
        },
        run: (workspace: TempTree): void => {
          workspace.write(path.join('repo', 'packages', 'a', 'dist', 'esm', 'index.js'), 'built\n');
        },
      },
    ])('does not record a pass when $case', async ({ prepare, run }, { nmr, repo, workspace }) => {
      prepare(workspace);
      nmr.runSteps.mockImplementation(() => {
        run(workspace);
        return Promise.resolve({ exitCode: 0 });
      });

      const { stderr } = await nmr.runReadingStderr([COMMAND], repo, DEBUG_ENV);

      expect(countCacheEntries(workspace)).toBe(0);
      expect(stderr).toContain("packages/a's build output changed while it ran");
    });

    // The bypass applies to the lookup, not to the recording.
    it('does not record a pass under --no-cache when the digest changes mid-run', async ({ nmr, repo, workspace }) => {
      nmr.runSteps.mockImplementation(() => {
        writeBuildDigest(workspace, 'repo/packages/a', 'digest-from-a-concurrent-build');
        return Promise.resolve({ exitCode: 0 });
      });

      await nmr.run(['--no-cache', COMMAND], repo);

      expect(countCacheEntries(workspace)).toBe(0);
    });

    // The second run rewrites the digest that the first left behind; its two reads agree, and it records.
    it('settles once the digest stands still', async ({ nmr, repo, workspace }) => {
      nmr.runSteps.mockImplementation(() => {
        writeBuildDigest(workspace, 'repo/packages/a', 'digest-from-a-concurrent-build');
        return Promise.resolve({ exitCode: 0 });
      });
      await nmr.run([COMMAND], repo);
      await nmr.run([COMMAND], repo);

      await nmr.run([COMMAND], repo);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
    });
  });
});
