import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeCheckCacheEntry } from '../check-cache-entries.ts';
import {
  COMMAND,
  countCacheEntries,
  countRuns,
  LOG_ENTRY,
  readEntry,
  readLog,
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

  describe('a tree that has not changed', () => {
    it('runs the first time and skips the second', async () => {
      expect((await runNmr(COMMAND, repo)).exitCode).toBe(0);
      expect(countRuns(workspace)).toBe(1);

      const secondRun = await runNmr(COMMAND, repo);

      expect(secondRun.exitCode).toBe(0);
      expect(countRuns(workspace)).toBe(1);
      expect(secondRun.stdout).toContain('passed');
    });

    it('names the scope, the command, and the tree on the skip line', async () => {
      await runNmr(COMMAND, repo);

      const { stdout } = await runNmr(COMMAND, repo);

      expect(stdout).toContain(`SKIP ${path.basename(repo)}: ${COMMAND}:`);
      expect(stdout).toContain('on this tree');
    });

    it('reports the skip under --quiet, which suppresses the command output and not the verdict', async () => {
      await runNmr(COMMAND, repo);

      const { stdout, exitCode } = await runNmr(`-q ${COMMAND}`, repo);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`SKIP ${path.basename(repo)}: ${COMMAND}:`);
      expect(countRuns(workspace)).toBe(1);
    });

    // The boundary belongs to the command's shape, not to the run's outcome, so a command that usually skips
    // would otherwise report it almost never.
    it('reports a shelled nmr step although the run skipped', async () => {
      const bin = writeNmrShim(workspace, log);
      writeConfig(workspace, log, { command: 'nmr ok' });
      const withShimEnv = { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` };

      await runNmr(COMMAND, repo, withShimEnv);
      const { stdout, stderr } = await runNmr(COMMAND, repo, withShimEnv);

      expect(stdout).toContain('passed');
      expect(stderr).toContain('`rootScripts.typecheck` reaches nmr through a shell (`nmr ok`)');
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

    it('records one pass per scope; a command run at the root skips at the root', async () => {
      await runNmr(COMMAND, repo);

      // The same tree, asked the same question, from a subdirectory of the root rather than the root itself.
      const { exitCode } = await runNmr(COMMAND, path.join(repo, 'tools'));

      expect(exitCode).toBe(0);
      expect(countRuns(workspace)).toBe(1);
    });

    it('runs here although a host recorded a pass for this tree', async () => {
      await runNmr(COMMAND, repo);
      const entry = await readEntry(repo);
      assert.ok(entry !== undefined);
      await writeCheckCacheEntry({
        anchorDir: repo,
        command: COMMAND,
        entry: { ...entry, host: 'imac' },
        monorepoRoot: repo,
      });

      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(countRuns(workspace)).toBe(2);
      expect(stderr).toContain('the last pass was earned on imac');
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

  describe('what is never recorded', () => {
    it('does not record a failing run', async () => {
      writeConfig(workspace, log, { command: `echo ran >> ${log} && exit 3` });

      expect((await runNmr(COMMAND, repo)).exitCode).toBe(3);
      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(2);
    });

    it('does not record a run that changed the tree about which it was asked', async () => {
      // A check that rewrites a file describes a tree that no longer exists by the time it finishes.
      writeConfig(workspace, log, { command: `echo ran >> ${log} && echo more >> ${path.join(repo, 'touched.txt')}` });

      await runNmr(COMMAND, repo);
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(countRuns(workspace)).toBe(2);
      expect(stderr).toContain('the tree changed while it ran');
    });

    it('does not record a run that executed nothing', async () => {
      // `NMR_RUN_IF_PRESENT` turns an unresolvable command into a silent success; nothing ran, so nothing passed.
      // The package declares `ghost` so that the config resolves it, which is the shape that a fan-out has: The
      // command exists in some scopes and not in the one being run.
      workspace.write(
        'repo/packages/a/package.json',
        JSON.stringify({ name: 'a', scripts: { ghost: 'true' }, type: 'module' }),
      );
      writeConfig(workspace, log, { checkCache: { extraCommands: ['ghost'] } });

      const { exitCode } = await runNmr('ghost', repo, { NMR_RUN_IF_PRESENT: '1' });

      expect(exitCode).toBe(0);
      expect(countCacheEntries(workspace)).toBe(0);
    });

    it('does not record a command run with arguments', async () => {
      // Arguments take a command out of scope, because they change what it does in ways the gate cannot see.
      await runNmr(`${COMMAND} --flag`, repo);

      expect(countCacheEntries(workspace)).toBe(0);
    });
  });

  describe('--no-cache', () => {
    it('runs a command that the cache would have skipped, and records the result', async () => {
      await runNmr(COMMAND, repo);

      await runNmr(`--no-cache ${COMMAND}`, repo);
      expect(countRuns(workspace)).toBe(2);

      // The bypass recorded its result: The next ordinary run skips again rather than paying for the bypass twice.
      await runNmr(COMMAND, repo);
      expect(countRuns(workspace)).toBe(2);
    });

    it('applies to the whole chain through the environment', async () => {
      await runNmr(COMMAND, repo);

      const { exitCode } = await runNmr(COMMAND, repo, { NMR_NO_CACHE: '1' });

      expect(exitCode).toBe(0);
      expect(countRuns(workspace)).toBe(2);
    });

    it('warns when it follows the command name, which makes it an argument', async () => {
      const { stderr } = await runNmr(`${COMMAND} --no-cache`, repo);

      expect(stderr).toContain(`nmr --no-cache ${COMMAND}`);
    });

    it('says nothing about a --no-cache after a command that the cache never covers', async () => {
      const { stderr } = await runNmr('fmt --no-cache', repo);

      expect(stderr).not.toContain('Did you mean');
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

  describe('one tree, observed once', () => {
    it('hands the snapshot down to the processes that it spawns', async () => {
      // A chain of nmr invocations gates on one observation rather than re-hashing the tree at every link.
      writeConfig(workspace, log, {
        extraRootScripts: { check: ['show-snapshot'], 'show-snapshot': `printenv NMR_TREE_SNAPSHOT >> ${log}` },
      });

      await runNmr('check', repo);

      expect(readLog(workspace)[0]).toMatch(/^[\da-f]{40} [\da-f]{40}$/);
    });

    it('records every cacheable constituent of one green run', async () => {
      // One pass of the composite leaves the command that it composed skippable on its own.
      writeConfig(workspace, log, { extraRootScripts: { check: [COMMAND] } });

      await runNmr('check', repo);
      expect(countRuns(workspace)).toBe(1);

      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(1);
    });
  });

  describe('when the cache does not apply', () => {
    it('never gates a command excluded by the configuration', async () => {
      writeConfig(workspace, log, { checkCache: { excludeCommands: [COMMAND] } });

      await runNmr(COMMAND, repo);
      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(2);
    });

    it('never gates anything once the configuration turns it off', async () => {
      writeConfig(workspace, log, { checkCache: { enabled: false } });

      await runNmr(COMMAND, repo);
      await runNmr(COMMAND, repo);

      expect(countRuns(workspace)).toBe(2);
    });

    it('never gates a command outside the cacheable set', async () => {
      // `fmt` rewrites the tree about which it was asked, so a recorded pass would describe a tree that no longer
      // exists.
      writeConfig(workspace, log, { extraRootScripts: { fmt: `echo ran >> ${log}` } });

      await runNmr('fmt', repo);
      await runNmr('fmt', repo);

      expect(countRuns(workspace)).toBe(2);
      expect(countCacheEntries(workspace)).toBe(0);
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

    it('runs the command every time when the fixture does not have an install fingerprint to read', async () => {
      workspace.rm('repo/node_modules/.pnpm');

      await runNmr(COMMAND, repo);
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(countRuns(workspace)).toBe(2);
      expect(stderr).toContain('install fingerprint');
    });

    it('runs the command every time when devBin substitutes a different binary', async () => {
      // The substitute is built from somewhere the tree hash does not describe, so a pass by it is not a pass
      // by the command that the key names.
      writeConfig(workspace, log, {
        command: 'stand-in',
        devBin: { 'stand-in': `sh -c 'echo ran >> ${log}'` },
      });

      await runNmr(COMMAND, repo);
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(countRuns(workspace)).toBe(2);
      expect(stderr).toContain('devBin substituted');
    });

    it('says why a run missed when asked', async () => {
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(stderr).toContain('no pass recorded');
    });

    it('says nothing about its decisions unless asked', async () => {
      const { stderr } = await runNmr(COMMAND, repo);

      expect(stderr).toBe('');
    });
  });

  describe('an outcome that the command states about itself', () => {
    it('reaches the verdict when the command is a single step', async () => {
      writeConfig(workspace, log, { command: buildStatingCommand() });

      expect(readOwnVerdict(await runNmr(`--json ${COMMAND}`, repo))).toMatchObject({
        outcome: 'passed',
        stated: { kind: 'build-unchanged', savedMs: 2_100 },
      });
    });

    it.for([
      { case: 'one step of a two-step command', shape: 'chain' },
      { case: 'a hook around the command', shape: 'hook' },
      { case: 'a step that failed after stating it', shape: 'failure' },
    ] as const)('does not reach the verdict when stated by $case', async ({ shape }) => {
      const command = {
        chain: `${buildStatingCommand()} && echo ran`,
        failure: buildStatingCommand('; process.exit(3)'),
        hook: 'echo ran',
      }[shape];
      const hook = shape === 'hook' ? buildStatingCommand() : undefined;
      writeConfig(workspace, log, {
        command,
        ...(hook !== undefined && { extraRootScripts: { [`${COMMAND}:pre`]: hook } }),
      });

      const verdict = readOwnVerdict(await runNmr(`--json ${COMMAND}`, repo));

      expect(verdict).toBeDefined();
      expect(verdict).not.toHaveProperty('stated');
    });
  });
});

// region | Helpers

/** A command that states a build-cache hit through the file that nmr hands it, then runs `then`. */
function buildStatingCommand(then = ''): string {
  return `"${process.execPath}" -e "require('node:fs').writeFileSync(process.env.NMR_OUTCOME_FILE, JSON.stringify({ kind: 'build-unchanged', savedMs: 2100, parentPid: process.ppid }))${then}"`;
}

/** Returns the JSON verdict that a run reported for the fixture's command itself. */
function readOwnVerdict(run: { stdout: string }): unknown {
  return run.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line): unknown => JSON.parse(line))
    .find(
      (record) => typeof record === 'object' && record !== null && 'command' in record && record.command === COMMAND,
    );
}

// endregion | Helpers
