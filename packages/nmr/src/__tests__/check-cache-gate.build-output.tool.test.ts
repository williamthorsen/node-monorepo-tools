import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMAND,
  countCacheEntries,
  countRuns,
  LOG_ENTRY,
  rebuildDigest,
  runNmr,
  scaffoldRepo,
  writeBuildDigest,
  writeConfig,
} from '../test-utils/check-cache-gate-fixtures.ts';

describe('the check-result cache gate', () => {
  let workspace: TempTree;
  let repo: string;
  let log: string;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-gate-' }));
    repo = workspace.resolve('repo');
    // Keep the log outside the repository: A log inside it would be an untracked file, so every run would change
    // the very tree that the run is being recorded against.
    log = workspace.resolve(LOG_ENTRY);
    scaffoldRepo(workspace, log);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('build output that the tree hash cannot see', () => {
    it('runs again when a package’s build output has gone missing', async () => {
      // Output is git-ignored, so its removal does not change any hash: Only the probe stands between a deleted
      // `dist` and a green exit over a repository that cannot run.
      await runNmr(COMMAND, repo);

      workspace.rm('repo/packages/a/dist');
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(countRuns(workspace)).toBe(2);
      expect(stderr).toContain('packages/a does not have build output');
    });

    it('runs again when the output on disk came from a different tree', async () => {
      // Restoring a tree restores none of its build output: `git stash` and `git checkout` leave `dist` where
      // it was. Presence alone would let output compiled from another tree pass for this one, and the run
      // that would have rebuilt it is exactly the run being skipped.
      await runNmr(COMMAND, repo);

      writeBuildDigest(workspace, 'repo/packages/a', 'digest-from-another-tree');
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(countRuns(workspace)).toBe(2);
      expect(stderr).toContain('came from a different tree');
    });

    it('settles rather than missing forever once it has run against the output on disk', async () => {
      await runNmr(COMMAND, repo);
      writeBuildDigest(workspace, 'repo/packages/a', 'digest-from-another-tree');
      await runNmr(COMMAND, repo);

      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(2);
    });

    it('skips again once the output is back', async () => {
      await runNmr(COMMAND, repo);
      workspace.rm('repo/packages/a/dist');
      await runNmr(COMMAND, repo);

      workspace.write('repo/packages/a/dist/esm/index.js', 'export const value = 1;\n');

      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(2);
    });
  });

  describe('build output that moves while the check runs', () => {
    it('does not record a pass when a covered package’s digest changes mid-run', async () => {
      // The build cache is under gitignored `node_modules/`, so rewriting the digest does not change the tree
      // hash: The comparison of the two reads is the only thing that can catch it.
      writeConfig(workspace, log, {
        command: `echo ran >> ${log} && ${rebuildDigest(repo, 'digest-from-a-concurrent-build')}`,
      });

      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(countCacheEntries(workspace)).toBe(0);
      expect(stderr).toContain("packages/a's build output changed while it ran");
    });

    it('does not record a pass when the run itself builds output that was absent', async () => {
      // The shape that `nmr ci` takes, whose chain builds what its checks then read. The gate declines the pass
      // because the pass cannot say which output it was earned over.
      const outputDir = path.join(repo, 'packages', 'a', 'dist', 'esm');
      writeConfig(workspace, log, {
        command: `echo ran >> ${log} && mkdir -p ${outputDir} && echo built > ${path.join(outputDir, 'index.js')}`,
      });
      workspace.rm('repo/packages/a/dist');

      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(countCacheEntries(workspace)).toBe(0);
      expect(stderr).toContain("packages/a's build output changed while it ran");
    });

    it('does not record a pass under --no-cache when the digest changes mid-run', async () => {
      // The bypass applies to the lookup, not the recording, so the comparison still stands between this run and
      // an entry describing output that it never saw.
      writeConfig(workspace, log, {
        command: `echo ran >> ${log} && ${rebuildDigest(repo, 'digest-from-a-concurrent-build')}`,
      });

      await runNmr(`--no-cache ${COMMAND}`, repo);

      expect(countCacheEntries(workspace)).toBe(0);
    });

    it('settles rather than missing forever once the digest stands still', async () => {
      // The second run rewrites the same digest that the first left behind; its two reads agree, and it records.
      writeConfig(workspace, log, {
        command: `echo ran >> ${log} && ${rebuildDigest(repo, 'digest-from-a-concurrent-build')}`,
      });
      await runNmr(COMMAND, repo);
      await runNmr(COMMAND, repo);

      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(2);
    });
  });
});
