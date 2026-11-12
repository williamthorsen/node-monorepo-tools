import { execFileSync } from 'node:child_process';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMAND,
  countRuns,
  LOG_ENTRY,
  runNmr,
  scaffoldRepo,
  writeConfig,
} from '../../test-utils/check-cache-gate-fixtures.ts';

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

  describe('a tree that has not changed', () => {
    it('runs the first time and skips the second', async () => {
      expect((await runNmr(COMMAND, repo)).exitCode).toBe(0);
      expect(countRuns(workspace)).toBe(1);

      const secondRun = await runNmr(COMMAND, repo);

      expect(secondRun.exitCode).toBe(0);
      expect(countRuns(workspace)).toBe(1);
      expect(secondRun.stdout).toContain('passed');
    });

    it('skips once the checked tree is committed, because the pass describes content rather than a commit', async () => {
      workspace.write('repo/src/index.ts', 'export const value = 2;\n');
      await runNmr(COMMAND, repo);

      execFileSync('git', ['commit', '--all', '--quiet', '--message', 'commit the checked tree'], {
        cwd: repo,
        stdio: 'ignore',
      });
      const afterCommit = await runNmr(COMMAND, repo);

      expect(afterCommit.exitCode).toBe(0);
      expect(countRuns(workspace)).toBe(1);
    });
  });

  describe('a tree that has changed', () => {
    it('runs again when a tracked file’s content changes', async () => {
      await runNmr(COMMAND, repo);

      workspace.write('repo/src/index.ts', 'export const value = 2;\n');

      expect((await runNmr(COMMAND, repo)).exitCode).toBe(0);
      expect(countRuns(workspace)).toBe(2);
    });

    it('runs again when an untracked file appears', async () => {
      await runNmr(COMMAND, repo);

      workspace.write('repo/src/added.ts', 'export const added = true;\n');

      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(2);
    });
  });

  describe('an invocation with arguments', () => {
    // The arguments take the invocation itself out of scope, but its steps are separate nmr processes without
    // arguments of their own. A step that declines them would otherwise skip from a recorded pass while its
    // narrowed siblings ran.
    it('does not serve any step of its chain from a recorded pass, the declining one included', async () => {
      writeConfig(workspace, log, {
        command: [{ run: 'lint:check', shouldDeclineArguments: true }, 'fmt:check'],
        extraRootScripts: { 'fmt:check': `echo fmt >> ${log}`, 'lint:check': `echo lint >> ${log}` },
      });

      await runNmr(COMMAND, repo);
      expect(countRuns(workspace)).toBe(2);

      await runNmr(`${COMMAND} --flag`, repo);

      expect(countRuns(workspace)).toBe(4);
    });

    it('still records the pass earned by a declining step, having run its whole work', async () => {
      writeConfig(workspace, log, {
        command: [{ run: 'lint:check', shouldDeclineArguments: true }, 'fmt:check'],
        extraRootScripts: { 'fmt:check': `echo fmt >> ${log}`, 'lint:check': `echo lint >> ${log}` },
      });

      await runNmr(`${COMMAND} --flag`, repo);
      expect(countRuns(workspace)).toBe(2);

      // Only `lint:check` recorded a pass, so only it skips.
      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(3);
    });
  });

  it('records every cacheable constituent of one green run', async () => {
    // One pass of the composite leaves the command that it composed skippable on its own.
    writeConfig(workspace, log, { extraRootScripts: { check: [COMMAND] } });

    await runNmr('check', repo);
    expect(countRuns(workspace)).toBe(1);

    await runNmr(COMMAND, repo);

    expect(countRuns(workspace)).toBe(1);
  });

  it('runs the command every time outside a git repository, and gives the reason under NMR_DEBUG', async () => {
    workspace.rm('repo/.git');
    // Point git at a directory that does not exist, so that it skips discovery and cannot find any repository,
    // whether one contains the temp root or a remnant of `repo/.git` survives the removal.
    vi.stubEnv('GIT_DIR', workspace.resolve('no-repository'));

    await runNmr(COMMAND, repo);
    const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

    expect(countRuns(workspace)).toBe(2);
    expect(stderr).toContain('not a git repository');
  });
});
