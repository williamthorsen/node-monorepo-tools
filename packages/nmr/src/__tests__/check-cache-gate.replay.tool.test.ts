import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { hashWorkingTree } from '@williamthorsen/nmr-core';
import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RUN_ID_ENV_VAR } from '../check-cache.ts';
import { type CheckCacheEntry, writeCheckCacheEntry } from '../check-cache-entries.ts';
import {
  COMMAND,
  countRuns,
  LOG_ENTRY,
  readEntry,
  runNmr,
  scaffoldRepo,
  writeConfig,
  writeNmrShim,
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

  describe('retained output', () => {
    it('records an excerpt of the run beside the pass that it earned', async () => {
      writeConfig(workspace, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });

      await runNmr(COMMAND, repo);

      expect((await readEntry(repo))?.retention?.replay).toStrictEqual([
        { command: COMMAND, excerpt: '27 passed (27)', scope: path.basename(repo) },
      ]);
    });

    it('does not record any retention for a command that printed nothing', async () => {
      await runNmr(COMMAND, repo);

      const entry = await readEntry(repo);

      expect(entry?.key).toBeDefined();
      expect(entry?.retention).toBeUndefined();
    });

    it('draws the excerpt from stderr when stdout retained nothing', async () => {
      writeConfig(workspace, log, { command: `echo ran >> ${log} && echo '3 warnings' 1>&2` });

      await runNmr(COMMAND, repo);

      expect((await readEntry(repo))?.retention?.replay).toStrictEqual([
        { command: COMMAND, excerpt: '3 warnings', scope: path.basename(repo) },
      ]);
    });

    it('draws the excerpt from the command rather than from a hook that ran after it', async () => {
      const bin = writeNmrShim(workspace, log, 'the hook output');
      writeConfig(workspace, log, {
        command: `echo ran >> ${log} && echo 'the command output'`,
        extraRootScripts: { [`${COMMAND}:post`]: 'echo post' },
      });

      await runNmr(COMMAND, repo, { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` });

      expect((await readEntry(repo))?.retention?.replay).toStrictEqual([
        { command: COMMAND, excerpt: 'the command output', scope: path.basename(repo) },
      ]);
    });

    // A composite hands its descriptors to the nmr processes below it and retains nothing of its own, which
    // keeps one verdict line reachable however far the tree beneath it fans out.
    it('does not record any retention for a composite, whose steps report for themselves', async () => {
      const bin = writeNmrShim(workspace, log, 'a constituent summary');
      writeConfig(workspace, log, { command: ['inner'] });

      await runNmr(COMMAND, repo, { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` });

      const entry = await readEntry(repo);

      expect(entry?.commandString).toBe('nmr inner');
      expect(entry?.retention).toBeUndefined();
    });

    it('records a pass without retention when the command wrote to a descriptor of its own', async () => {
      // `node:fs`, because the run hands the child an open descriptor, for which the tree does not expose any form.
      const terminalFd = fs.openSync(workspace.resolve('terminal.txt'), 'w');
      writeConfig(workspace, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });

      try {
        await runNmr(COMMAND, repo, {}, { terminalFd });
      } finally {
        fs.closeSync(terminalFd);
      }

      // The command wrote where nmr never saw it, so the pass stands and there is nothing to replay.
      expect(workspace.read('terminal.txt')).toContain('27 passed (27)');
      expect((await readEntry(repo))?.key).toBeDefined();
      expect((await readEntry(repo))?.retention).toBeUndefined();
    });

    it('replays the excerpt on the skip line, marked as a recording', async () => {
      writeConfig(workspace, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });
      await runNmr(COMMAND, repo);

      const { stdout } = await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(1);
      expect(stdout).toContain('replayed: 27 passed (27)');
    });

    it('reports the verdict alone when the recording describes another presentation environment', async () => {
      writeConfig(workspace, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });
      await runNmr(COMMAND, repo);

      const { stdout } = await runNmr(COMMAND, repo, { COLUMNS: '80' });

      // Still a pass on this tree; only the excerpt is another environment's.
      expect(countRuns(workspace)).toBe(1);
      expect(stdout).toContain('on this tree');
      expect(stdout).not.toContain('replayed:');
    });

    it('reports the verdict alone for a pass that retained nothing', async () => {
      await runNmr(COMMAND, repo);

      const { stdout } = await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(1);
      expect(stdout).toContain('on this tree');
      expect(stdout).not.toContain('replayed:');
    });

    it('does not leave any excerpt behind for a run whose pass was declined', async () => {
      writeConfig(workspace, log, { command: `echo ran >> ${log} && echo '27 passed (27)' && exit 3` });

      await runNmr(COMMAND, repo);

      await expect(readEntry(repo)).resolves.toBeUndefined();
    });
  });

  describe('an assembled replay', () => {
    /** The identity reported by the fixture's runs, standing in for the one generated by a top-level invocation. */
    const RUN = 'the-run';

    it('assembles a composite’s retention from what its constituents recorded', async () => {
      const treeHash = scaffoldComposite(['inner', 'other']);
      await plantConstituent({ command: 'inner', excerpt: '27 passed (27)', treeHash });
      await plantConstituent({ command: 'other', excerpt: 'no issues', treeHash });

      await runComposite();

      expect((await readEntry(repo))?.retention?.replay).toStrictEqual([
        { command: 'inner', excerpt: '27 passed (27)', scope: 'a-scope' },
        { command: 'other', excerpt: 'no issues', scope: 'a-scope' },
      ]);
    });

    it('replays an assembly attributed line by line, marked as a recording', async () => {
      const treeHash = scaffoldComposite(['inner', 'other']);
      await plantConstituent({ command: 'inner', excerpt: '27 passed (27)', treeHash });
      await plantConstituent({ command: 'other', excerpt: 'no issues', treeHash });
      await runComposite();

      const { stdout } = await runComposite();

      expect(stdout).toContain('replayed: a-scope: inner: 27 passed (27); a-scope: other: no issues');
      expect(stdout).not.toContain('passed in');
    });

    it('leaves out an excerpt certified by another run', async () => {
      const treeHash = scaffoldComposite(['inner']);
      await plantConstituent({ command: 'inner', excerpt: '27 passed (27)', runId: 'another-run', treeHash });

      await runComposite();

      expect((await readEntry(repo))?.retention).toBeUndefined();
    });

    it('leaves out an excerpt describing another tree', async () => {
      scaffoldComposite(['inner']);
      await plantConstituent({ command: 'inner', excerpt: '27 passed (27)', treeHash: 'another-tree' });

      await runComposite();

      expect((await readEntry(repo))?.retention).toBeUndefined();
    });

    // region | Helpers

    /** Writes the entry that a constituent's own run would have left behind at the fixture's scope. */
    async function plantConstituent(options: {
      command: string;
      excerpt: string;
      runId?: string;
      treeHash: string;
    }): Promise<void> {
      const entry: CheckCacheEntry = {
        key: `${options.command}-key`,
        treeHash: options.treeHash,
        headSha: 'head-sha',
        commandString: options.command,
        nmrVersion: '0.0.0',
        nodeVersion: 'v22.0.0',
        durationMs: 1_000,
        recordedAt: new Date().toISOString(),
        buildDigests: {},
        retention: {
          key: `${options.command}-retention`,
          replay: [{ command: options.command, excerpt: options.excerpt, scope: 'a-scope' }],
          runId: options.runId ?? RUN,
        },
      };

      await writeCheckCacheEntry({ anchorDir: repo, command: options.command, entry, monorepoRoot: repo });
    }

    /** Runs the fixture's composite, its elements spawning the shim, under one fixed run identity. */
    async function runComposite(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      const bin = writeNmrShim(workspace, log);

      return runNmr(COMMAND, repo, {
        PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
        [RUN_ID_ENV_VAR]: RUN,
      });
    }

    /**
     * Maps the fixture's cacheable command to a composite of the given elements, and returns the hash of the
     * tree that leaves behind: A planted constituent has to describe the tree against which the run will be
     * recorded.
     */
    function scaffoldComposite(elements: string[]): string {
      writeConfig(workspace, log, { command: elements });
      const hashResult = hashWorkingTree(repo);
      if (!hashResult.ok) {
        throw new Error(hashResult.reason);
      }

      return hashResult.hash;
    }

    // endregion | Helpers
  });

  describe('certifying what a skip replays', () => {
    const RUN = 'the-later-run';

    beforeEach(async () => {
      writeConfig(workspace, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });
      await runNmr(COMMAND, repo);
    });

    it('restamps the entry that it recalls with the run replaying it', async () => {
      const recordedEntry = await readEntry(repo);

      await runNmr(COMMAND, repo, { [RUN_ID_ENV_VAR]: RUN });

      const certifiedEntry = await readEntry(repo);
      expect(recordedEntry?.retention?.runId).not.toBe(RUN);
      expect(certifiedEntry?.retention?.runId).toBe(RUN);
    });

    it('leaves the instant and the duration recorded by the earning run alone', async () => {
      const recordedEntry = await readEntry(repo);

      await runNmr(COMMAND, repo, { [RUN_ID_ENV_VAR]: RUN });

      const certifiedEntry = await readEntry(repo);
      expect(certifiedEntry?.recordedAt).toBe(recordedEntry?.recordedAt);
      expect(certifiedEntry?.durationMs).toBe(recordedEntry?.durationMs);
    });

    it('certifies nothing when the recording describes another presentation environment', async () => {
      const recordedEntry = await readEntry(repo);

      await runNmr(COMMAND, repo, { COLUMNS: '80', [RUN_ID_ENV_VAR]: RUN });

      expect((await readEntry(repo))?.retention?.runId).toBe(recordedEntry?.retention?.runId);
    });
  });
});
