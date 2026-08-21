import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { RUN_IF_PRESENT_ENV_VAR, runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

/** The cacheable command every test drives; the fixture maps it to a script whose output is recognizable. */
const COMMAND = 'typecheck';

/** What the fixture's command writes, and so what a recording of it has to print back. */
const OUTPUT = 'checked 12 files';

/** The run log, which sits beside the repository rather than inside it. */
const LOG_ENTRY = 'log.txt';

describe('a run printed by --log', () => {
  let workspace: TempTree;
  let repo: string;
  let log: string;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-log-' }));
    repo = workspace.resolve('repo');
    // Outside the repository on purpose: a log inside it would be an untracked file, so every run would change
    // the very tree the run is being recorded against.
    log = workspace.resolve(LOG_ENTRY);
    scaffoldRepo(workspace, log);
  });

  describe('given a pass recorded on this tree', () => {
    beforeEach(async () => {
      await runNmr(COMMAND);
    });

    it('prints what the run wrote', async () => {
      const { exitCode, stdout } = await runNmr(`--log ${COMMAND}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(OUTPUT);
    });

    it('leads with the instant, the duration, and the command string that produced it', async () => {
      const { stdout } = await runNmr(`--log ${COMMAND}`);

      expect(stdout).toMatch(
        new RegExp(
          String.raw`^📼 ${path.basename(repo)}: ${COMMAND} — recorded \d{4}-.*ago\), ran in .*\n\$ .*echo`,
          'u',
        ),
      );
    });

    it('runs nothing and reports no verdict', async () => {
      const { stdout } = await runNmr(`--log ${COMMAND}`);

      expect(runCount()).toBe(1);
      expect(stdout).not.toContain('passed');
    });

    // The retention key certifies that a recording describes this presentation environment, which is what a
    // replayed excerpt is held to and what a dated recording is not.
    it('prints a recording made under another presentation environment', async () => {
      const { exitCode, stdout } = await runNmr(`--log ${COMMAND}`, { COLUMNS: '40', TERM: 'dumb' });

      expect(exitCode).toBe(0);
      expect(stdout).toContain(OUTPUT);
    });

    it('refuses once the tree has moved, naming the tree rather than printing the recording', async () => {
      workspace.write('repo/src/index.ts', 'export const value = 2;\n');

      const { exitCode, stderr, stdout } = await runNmr(`--log ${COMMAND}`);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('on a tree this is not');
      expect(stdout).toBe('');
    });
  });

  it('refuses when nothing has recorded a pass', async () => {
    const { exitCode, stderr, stdout } = await runNmr(`--log ${COMMAND}`);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('nothing has recorded a pass');
    expect(stdout).toBe('');
  });

  it('refuses for a command outside the cacheable set', async () => {
    const { exitCode, stderr } = await runNmr('--log fmt');

    expect(exitCode).toBe(1);
    expect(stderr).toContain('outside the check-result cache');
  });

  it('refuses when the run wrote to a terminal, retaining nothing', async () => {
    await runNmr(COMMAND, {}, { terminalFd: 1 });

    const { exitCode, stderr } = await runNmr(`--log ${COMMAND}`);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('retained none');
  });

  // A fan-out asks every selected scope, and the delegate marks the scopes it fanned out to.
  it('reports a gap without failing under a delegate', async () => {
    const { exitCode, stderr } = await runNmr(`--log ${COMMAND}`, { [RUN_IF_PRESENT_ENV_VAR]: '1' });

    expect(exitCode).toBe(0);
    expect(stderr).toContain('nothing has recorded a pass');
  });

  // The refusal points at NMR_DEBUG, so the gate has to have written a note for every way it stands aside.
  it('reports why the gate stood aside for a command carrying arguments', async () => {
    const { exitCode, stderr } = await runNmr(`--log ${COMMAND} --project unit`, { NMR_DEBUG: '1' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(`gate disabled: ${COMMAND} was passed arguments`);
    expect(stderr).toContain('standing aside here');
  });

  it('names the flag when no command follows it', async () => {
    const { exitCode, stderr } = await runNmr('--log');

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--log requires a command name');
  });

  // region | Helpers

  /** How many times the fixture's command has actually run. */
  function runCount(): number {
    return workspace.exists(LOG_ENTRY) ? workspace.read(LOG_ENTRY).trim().split('\n').length : 0;
  }

  async function runNmr(
    argString: string,
    extraEnv: Record<string, string> = {},
    options: { terminalFd?: number } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdout = asDestination(new PassThrough(), options.terminalFd);
    const stderr = asDestination(new PassThrough(), options.terminalFd);
    stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const { exitCode } = await runCli({
      args: argString.split(/\s+/u).filter((argument) => argument.length > 0),
      cwd: repo,
      env: { ...readAmbientEnv(), ...extraEnv },
      stdout,
      stderr,
    });

    return {
      exitCode,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    };
  }

  // endregion | Helpers
});

// region | Helpers

/**
 * Decorates a destination as a terminal on the given descriptor, so the runner hands the child that descriptor
 * and nmr sees none of what flows through it. Left undecorated, the stream carries no descriptor and is piped.
 */
function asDestination(stream: PassThrough, terminalFd: number | undefined): PassThrough {
  return terminalFd === undefined ? stream : Object.assign(stream, { fd: terminalFd, isTTY: true });
}

/** Runs git in `cwd`, discarding its output. */
function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/**
 * Writes a committed git repository under `repo/` in the workspace, holding the pnpm files the install
 * fingerprint reads and a config mapping the cacheable command to a script that both records its run and
 * writes a recognizable line.
 */
function scaffoldRepo(workspace: TempTree, log: string): void {
  const config = { rootScripts: { [COMMAND]: `echo ran >> ${log} && echo '${OUTPUT}'` } };

  workspace.writeAll({
    'repo/.config/nmr.config.ts': `export default ${JSON.stringify(config)};\n`,
    'repo/.gitignore': 'node_modules/\ndist/\n',
    'repo/node_modules/.modules.yaml': 'hoistPattern:\n  - "types"\n',
    'repo/node_modules/.pnpm/lock.yaml': 'lockfileVersion: "9.0"\n',
    'repo/package.json': JSON.stringify({ name: 'log-root', private: true }),
    'repo/pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
    'repo/src/index.ts': 'export const value = 1;\n',
  });

  const repo = workspace.resolve('repo');
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'fixture@example.com']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--message', 'initial']);
}

// endregion | Helpers
