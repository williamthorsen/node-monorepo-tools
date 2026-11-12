import { describe, expect } from 'vitest';

import {
  COMMAND,
  countCacheEntries,
  FAKE_HEAD_SHA,
  it,
  LOG_ENTRY,
  writeConfig,
} from '../../test-utils/check-cache-gate-fixtures.ts';
import { encodeTreeSnapshot, TREE_SNAPSHOT_ENV_VAR } from '../check-cache.ts';

const DEBUG_ENV = { NMR_DEBUG: '1' };

describe('the check-result cache gate', () => {
  describe('when the cache does not apply', () => {
    it.for([
      { case: 'a command excluded by the configuration', checkCache: { excludeCommands: [COMMAND] }, command: COMMAND },
      { case: 'any command once the configuration turns it off', checkCache: { enabled: false }, command: COMMAND },
      { case: 'a command outside the cacheable set', checkCache: undefined, command: 'fmt' },
    ])('never gates $case', async ({ checkCache, command }, { nmr, repo, workspace }) => {
      writeConfig(workspace, workspace.resolve(LOG_ENTRY), {
        ...(checkCache !== undefined && { checkCache }),
        extraRootScripts: { fmt: 'echo fmt' },
      });

      await nmr.run([command], repo);
      await nmr.run([command], repo);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
      expect(countCacheEntries(workspace)).toBe(0);
    });

    // Arguments change what a command does in ways that the gate cannot read.
    it('does not record a command run with arguments', async ({ nmr, repo, workspace }) => {
      const { stderr } = await nmr.runReadingStderr([COMMAND, '--flag'], repo, DEBUG_ENV);

      expect(countCacheEntries(workspace)).toBe(0);
      expect(stderr).toContain(`${COMMAND} was passed arguments`);
    });

    it('runs every time, and says why when asked, when the tree cannot be snapshotted', async ({ nmr, repo }) => {
      nmr.readTree.hashWorkingTree.mockReturnValue({ ok: false, reason: 'not a git repository: fake' });

      await nmr.run([COMMAND], repo);
      const { stderr } = await nmr.runReadingStderr([COMMAND], repo, DEBUG_ENV);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
      expect(stderr).toContain('not a git repository');
    });

    it('runs every time, and says why when asked, without an install fingerprint', async ({ nmr, repo, workspace }) => {
      workspace.rm('repo/node_modules/.pnpm');

      await nmr.run([COMMAND], repo);
      const { stderr } = await nmr.runReadingStderr([COMMAND], repo, DEBUG_ENV);

      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
      expect(stderr).toContain('install fingerprint');
    });

    // `NMR_RUN_IF_PRESENT` turns an unresolvable command into a silent success; nothing ran, so nothing passed. The
    // package declares `ghost` so that the config resolves it, which is the shape of a fan-out in which the command
    // exists in some scopes and not in the one being run.
    it('does not record a run that executed nothing', async ({ nmr, repo, workspace }) => {
      workspace.write(
        'repo/packages/a/package.json',
        JSON.stringify({ name: 'a', scripts: { ghost: 'true' }, type: 'module' }),
      );
      writeConfig(workspace, workspace.resolve(LOG_ENTRY), { checkCache: { extraCommands: ['ghost'] } });

      const { exitCode } = await nmr.run(['ghost'], repo, { NMR_RUN_IF_PRESENT: '1' });

      expect(exitCode).toBe(0);
      expect(countCacheEntries(workspace)).toBe(0);
    });
  });

  describe('--no-cache', () => {
    it('runs a command that the cache would have skipped, and records the result', async ({ nmr, repo }) => {
      await nmr.run([COMMAND], repo);

      await nmr.run(['--no-cache', COMMAND], repo);
      expect(nmr.runSteps).toHaveBeenCalledTimes(2);

      await nmr.run([COMMAND], repo);
      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
    });

    it('applies through the environment', async ({ nmr, repo }) => {
      await nmr.run([COMMAND], repo);

      const { exitCode } = await nmr.run([COMMAND], repo, { NMR_NO_CACHE: '1' });

      expect(exitCode).toBe(0);
      expect(nmr.runSteps).toHaveBeenCalledTimes(2);
    });

    it('warns when it follows the command name, which makes it an argument', async ({ nmr, repo }) => {
      const { stderr } = await nmr.runReadingStderr([COMMAND, '--no-cache'], repo);

      expect(stderr).toContain(`nmr --no-cache ${COMMAND}`);
    });

    it('does not warn after a command that the cache never covers', async ({ nmr, repo }) => {
      const { stderr } = await nmr.runReadingStderr(['fmt', '--no-cache'], repo);

      expect(stderr).not.toContain('nmr --no-cache fmt');
      expect(stderr).not.toContain('Did you mean');
    });
  });

  // A chain of nmr invocations gates on one observation rather than hashing the tree again at every link.
  it('hands the snapshot down to the processes that it spawns', async ({ nmr, repo }) => {
    await nmr.run([COMMAND], repo);

    expect(nmr.runSteps.mock.calls[0]?.[2].env?.[TREE_SNAPSHOT_ENV_VAR]).toBe(
      encodeTreeSnapshot({ headSha: FAKE_HEAD_SHA, treeId: 'tree-1' }),
    );
  });
});
