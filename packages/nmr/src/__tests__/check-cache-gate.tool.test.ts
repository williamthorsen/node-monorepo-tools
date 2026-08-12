import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CheckCacheEntry } from '../check-cache.ts';
import { readCheckCacheEntry } from '../check-cache.ts';
import { resolveBuildCachePath } from '../commands/build-output.ts';
import { runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

/** The cacheable command every test drives; the fixture maps it to a script whose runs are countable. */
const COMMAND = 'typecheck';

describe('the check-result cache gate', () => {
  let workspace: string;
  let repo: string;
  let log: string;

  beforeEach(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-gate-')));
    repo = path.join(workspace, 'repo');
    // Outside the repository on purpose: a log inside it would be an untracked file, so every run would change
    // the very tree the run is being recorded against.
    log = path.join(workspace, 'log.txt');
    scaffoldRepo(repo, log);
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  describe('a tree that has not changed', () => {
    it('runs the first time and skips the second', async () => {
      expect((await runNmr(COMMAND, repo)).exitCode).toBe(0);
      expect(runCount()).toBe(1);

      const second = await runNmr(COMMAND, repo);

      expect(second.exitCode).toBe(0);
      expect(runCount()).toBe(1);
      expect(second.stdout).toContain('passed');
    });

    it('names the scope, the command, and the tree on the skip line', async () => {
      await runNmr(COMMAND, repo);

      const { stdout } = await runNmr(COMMAND, repo);

      expect(stdout).toContain(`⏭️ ${path.basename(repo)}: ${COMMAND}:`);
      expect(stdout).toContain('on this tree');
    });

    it('reports the skip under --quiet, which suppresses the command output and not the verdict', async () => {
      await runNmr(COMMAND, repo);

      const { stdout, exitCode } = await runNmr(`-q ${COMMAND}`, repo);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`⏭️ ${path.basename(repo)}: ${COMMAND}:`);
      expect(runCount()).toBe(1);
    });

    // The boundary belongs to the command's shape, not to the run's outcome, so a command that usually skips
    // would otherwise report it almost never.
    it('reports a shelled nmr step although the run skipped', async () => {
      const bin = writeNmrShim(workspace, log);
      writeConfig(repo, log, { command: 'nmr ok' });
      const withShim = { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` };

      await runNmr(COMMAND, repo, withShim);
      const { stdout, stderr } = await runNmr(COMMAND, repo, withShim);

      expect(stdout).toContain('passed');
      expect(stderr).toContain('`rootScripts.typecheck` reaches nmr through a shell (`nmr ok`)');
    });

    it('records one pass per scope, so a command run at the root skips at the root', async () => {
      await runNmr(COMMAND, repo);

      // The same tree, asked the same question, from a subdirectory of the root rather than the root itself.
      const { exitCode } = await runNmr(COMMAND, path.join(repo, 'tools'));

      expect(exitCode).toBe(0);
      expect(runCount()).toBe(1);
    });
  });

  describe('a tree that has changed', () => {
    it('runs again when a tracked file’s content changes', async () => {
      await runNmr(COMMAND, repo);

      fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const value = 2;\n');

      expect((await runNmr(COMMAND, repo)).exitCode).toBe(0);
      expect(runCount()).toBe(2);
    });

    it('runs again when an untracked file appears', async () => {
      await runNmr(COMMAND, repo);

      fs.writeFileSync(path.join(repo, 'src', 'added.ts'), 'export const added = true;\n');

      await runNmr(COMMAND, repo);

      expect(runCount()).toBe(2);
    });
  });

  describe('what is never recorded', () => {
    it('does not record a failing run', async () => {
      writeConfig(repo, log, { command: `echo ran >> ${log} && exit 3` });

      expect((await runNmr(COMMAND, repo)).exitCode).toBe(3);
      await runNmr(COMMAND, repo);

      expect(runCount()).toBe(2);
    });

    it('does not record a run that changed the tree it was asked about', async () => {
      // A check that rewrites a file describes a tree that no longer exists by the time it finishes.
      writeConfig(repo, log, { command: `echo ran >> ${log} && echo more >> ${path.join(repo, 'touched.txt')}` });

      await runNmr(COMMAND, repo);
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(runCount()).toBe(2);
      expect(stderr).toContain('the tree changed while it ran');
    });

    it('does not record a run that executed nothing', async () => {
      // `NMR_RUN_IF_PRESENT` turns an unresolvable command into a silent success; nothing ran, so nothing passed.
      writeConfig(repo, log, { checkCache: { extraCommands: ['ghost'] } });

      const { exitCode } = await runNmr('ghost', repo, { NMR_RUN_IF_PRESENT: '1' });

      expect(exitCode).toBe(0);
      expect(cacheEntryCount()).toBe(0);
    });

    it('does not record a command carrying arguments', async () => {
      // Arguments change what a command does in ways the gate cannot see, so they take it out of scope.
      await runNmr(`${COMMAND} --flag`, repo);

      expect(cacheEntryCount()).toBe(0);
    });
  });

  describe('--no-cache', () => {
    it('runs a command the cache would have skipped, and records the result', async () => {
      await runNmr(COMMAND, repo);

      await runNmr(`--no-cache ${COMMAND}`, repo);
      expect(runCount()).toBe(2);

      // Re-recorded, so the next ordinary run skips again rather than paying for the bypass twice.
      await runNmr(COMMAND, repo);
      expect(runCount()).toBe(2);
    });

    it('reaches the whole chain through the environment', async () => {
      await runNmr(COMMAND, repo);

      const { exitCode } = await runNmr(COMMAND, repo, { NMR_NO_CACHE: '1' });

      expect(exitCode).toBe(0);
      expect(runCount()).toBe(2);
    });

    it('warns when it lands after the command name, where it is an argument', async () => {
      const { stderr } = await runNmr(`${COMMAND} --no-cache`, repo);

      expect(stderr).toContain(`nmr --no-cache ${COMMAND}`);
    });

    it('says nothing about a --no-cache after a command the cache never covers', async () => {
      const { stderr } = await runNmr('fmt --no-cache', repo);

      expect(stderr).not.toContain('Did you mean');
    });
  });

  describe('one tree, observed once', () => {
    it('hands the snapshot down to the processes it spawns', async () => {
      // A chain of nmr invocations gates on one observation rather than re-hashing the tree at every link.
      writeConfig(repo, log, {
        extraRootScripts: { check: ['show-snapshot'], 'show-snapshot': `printenv NMR_TREE_SNAPSHOT >> ${log}` },
      });

      await runNmr('check', repo);

      expect(readLog()[0]).toMatch(/^[\da-f]{64} [\da-f]{40}$/);
    });

    it('records every cacheable constituent of one green run', async () => {
      // One pass of the composite leaves the command it composed skippable on its own.
      writeConfig(repo, log, { extraRootScripts: { check: [COMMAND] } });

      await runNmr('check', repo);
      expect(runCount()).toBe(1);

      await runNmr(COMMAND, repo);

      expect(runCount()).toBe(1);
    });
  });

  describe('when the gate stands aside', () => {
    it('never gates a command the configuration excludes', async () => {
      writeConfig(repo, log, { checkCache: { excludeCommands: [COMMAND] } });

      await runNmr(COMMAND, repo);
      await runNmr(COMMAND, repo);

      expect(runCount()).toBe(2);
    });

    it('never gates anything once the configuration turns it off', async () => {
      writeConfig(repo, log, { checkCache: { enabled: false } });

      await runNmr(COMMAND, repo);
      await runNmr(COMMAND, repo);

      expect(runCount()).toBe(2);
    });

    it('never gates a command outside the cacheable set', async () => {
      // `fmt` rewrites the tree it was asked about, so a recorded pass would describe a tree that no longer exists.
      writeConfig(repo, log, { extraRootScripts: { fmt: `echo ran >> ${log}` } });

      await runNmr('fmt', repo);
      await runNmr('fmt', repo);

      expect(runCount()).toBe(2);
      expect(cacheEntryCount()).toBe(0);
    });

    it('stands aside outside a git repository, and says why when asked', async () => {
      fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });

      await runNmr(COMMAND, repo);
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(runCount()).toBe(2);
      expect(stderr).toContain('not a git repository');
    });

    it('stands aside when there is no install fingerprint to read', async () => {
      fs.rmSync(path.join(repo, 'node_modules', '.pnpm'), { recursive: true, force: true });

      await runNmr(COMMAND, repo);
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(runCount()).toBe(2);
      expect(stderr).toContain('install fingerprint');
    });

    it('stands aside when devBin substitutes a different binary', async () => {
      // The substitute is built from somewhere the tree hash does not describe, so a pass by it is not a pass
      // by the command the key names.
      writeConfig(repo, log, {
        command: 'stand-in',
        devBin: { 'stand-in': `sh -c 'echo ran >> ${log}'` },
      });

      await runNmr(COMMAND, repo);
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(runCount()).toBe(2);
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

  describe('retained output', () => {
    it('records an excerpt of the run beside the pass it earned', async () => {
      writeConfig(repo, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });

      await runNmr(COMMAND, repo);

      expect((await readEntry())?.retention?.replay).toStrictEqual([
        { command: COMMAND, excerpt: '27 passed (27)', scope: path.basename(repo) },
      ]);
    });

    it('records no retention for a command that printed nothing', async () => {
      await runNmr(COMMAND, repo);

      const entry = await readEntry();

      expect(entry?.key).toBeDefined();
      expect(entry?.retention).toBeUndefined();
    });

    it('draws the excerpt from stderr where stdout retained nothing', async () => {
      writeConfig(repo, log, { command: `echo ran >> ${log} && echo '3 warnings' 1>&2` });

      await runNmr(COMMAND, repo);

      expect((await readEntry())?.retention?.replay).toStrictEqual([
        { command: COMMAND, excerpt: '3 warnings', scope: path.basename(repo) },
      ]);
    });

    it('draws the excerpt from the command rather than from a hook that ran after it', async () => {
      const bin = writeNmrShim(workspace, log, 'the hook output');
      writeConfig(repo, log, {
        command: `echo ran >> ${log} && echo 'the command output'`,
        extraRootScripts: { [`${COMMAND}:post`]: 'echo post' },
      });

      await runNmr(COMMAND, repo, { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` });

      expect((await readEntry())?.retention?.replay).toStrictEqual([
        { command: COMMAND, excerpt: 'the command output', scope: path.basename(repo) },
      ]);
    });

    // A composite hands its descriptors to the nmr processes below it and retains nothing of its own, which is
    // what keeps one verdict line reachable however far the tree beneath it fans out.
    it('records no retention for a composite, whose steps report for themselves', async () => {
      const bin = writeNmrShim(workspace, log, 'a constituent summary');
      writeConfig(repo, log, { command: ['inner'] });

      await runNmr(COMMAND, repo, { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` });

      const entry = await readEntry();

      expect(entry?.commandString).toBe('nmr inner');
      expect(entry?.retention).toBeUndefined();
    });

    it('records a pass and no retention when the command wrote to a descriptor of its own', async () => {
      const terminalPath = path.join(workspace, 'terminal.txt');
      const terminalFd = fs.openSync(terminalPath, 'w');
      writeConfig(repo, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });

      try {
        await runNmr(COMMAND, repo, {}, { terminalFd });
      } finally {
        fs.closeSync(terminalFd);
      }

      // The command wrote where nmr never saw it, so the pass stands and there is nothing to replay.
      expect(fs.readFileSync(terminalPath, 'utf8')).toContain('27 passed (27)');
      expect((await readEntry())?.key).toBeDefined();
      expect((await readEntry())?.retention).toBeUndefined();
    });

    it('replays the excerpt on the skip line, marked as a recording', async () => {
      writeConfig(repo, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });
      await runNmr(COMMAND, repo);

      const { stdout } = await runNmr(COMMAND, repo);

      expect(runCount()).toBe(1);
      expect(stdout).toContain('replayed: 27 passed (27)');
    });

    it('reports the verdict alone when the recording describes another presentation environment', async () => {
      writeConfig(repo, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });
      await runNmr(COMMAND, repo);

      const { stdout } = await runNmr(COMMAND, repo, { COLUMNS: '80' });

      // Still a pass on this tree; only the excerpt is another environment's.
      expect(runCount()).toBe(1);
      expect(stdout).toContain('on this tree');
      expect(stdout).not.toContain('replayed:');
    });

    it('reports the verdict alone for a pass that retained nothing', async () => {
      await runNmr(COMMAND, repo);

      const { stdout } = await runNmr(COMMAND, repo);

      expect(runCount()).toBe(1);
      expect(stdout).toContain('on this tree');
      expect(stdout).not.toContain('replayed:');
    });

    it('leaves no excerpt behind for a run whose pass was declined', async () => {
      writeConfig(repo, log, { command: `echo ran >> ${log} && echo '27 passed (27)' && exit 3` });

      await runNmr(COMMAND, repo);

      await expect(readEntry()).resolves.toBeUndefined();
    });
  });

  describe('build output the tree hash cannot see', () => {
    it('runs again when a package’s build output has gone missing', async () => {
      // Output is git-ignored, so its removal moves no hash: only the probe stands between a deleted `dist`
      // and a green exit over a repository that cannot run.
      await runNmr(COMMAND, repo);

      fs.rmSync(path.join(repo, 'packages', 'a', 'dist'), { recursive: true, force: true });
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(runCount()).toBe(2);
      expect(stderr).toContain('packages/a has no build output');
    });

    it('runs again when the output on disk came from a different tree', async () => {
      // Restoring a tree restores none of its build output: `git stash` and `git checkout` leave `dist` where
      // it was. Presence alone would let output compiled from another tree pass for this one, and the run
      // that would have rebuilt it is exactly the run being skipped.
      await runNmr(COMMAND, repo);

      writeBuildDigest(path.join(repo, 'packages', 'a'), 'digest-from-another-tree');
      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(runCount()).toBe(2);
      expect(stderr).toContain('came from a different tree');
    });

    it('settles rather than missing forever once it has run against the output on disk', async () => {
      await runNmr(COMMAND, repo);
      writeBuildDigest(path.join(repo, 'packages', 'a'), 'digest-from-another-tree');
      await runNmr(COMMAND, repo);

      await runNmr(COMMAND, repo);

      expect(runCount()).toBe(2);
    });

    it('skips again once the output is back', async () => {
      await runNmr(COMMAND, repo);
      fs.rmSync(path.join(repo, 'packages', 'a', 'dist'), { recursive: true, force: true });
      await runNmr(COMMAND, repo);

      fs.mkdirSync(path.join(repo, 'packages', 'a', 'dist', 'esm'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'packages', 'a', 'dist', 'esm', 'index.js'), 'export const value = 1;\n');

      await runNmr(COMMAND, repo);

      expect(runCount()).toBe(2);
    });
  });

  describe('build output that moves while the check runs', () => {
    it('records no pass when a covered package’s digest changes mid-run', async () => {
      // The build cache lives under gitignored `node_modules/`, so rewriting the digest moves no tree hash:
      // the comparison of the two reads is the only thing that can catch it.
      writeConfig(repo, log, { command: `echo ran >> ${log} && ${rebuildDigest('digest-from-a-concurrent-build')}` });

      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(cacheEntryCount()).toBe(0);
      expect(stderr).toContain("packages/a's build output changed while it ran");
    });

    it('records no pass when the run itself builds output that was absent', async () => {
      // The shape `nmr ci` takes, whose chain builds what its checks then read. Declining is deliberate: the
      // pass cannot say which output it was earned over.
      const outputDir = path.join(repo, 'packages', 'a', 'dist', 'esm');
      writeConfig(repo, log, {
        command: `echo ran >> ${log} && mkdir -p ${outputDir} && echo built > ${path.join(outputDir, 'index.js')}`,
      });
      fs.rmSync(path.join(repo, 'packages', 'a', 'dist'), { recursive: true, force: true });

      const { stderr } = await runNmr(COMMAND, repo, { NMR_DEBUG: '1' });

      expect(cacheEntryCount()).toBe(0);
      expect(stderr).toContain("packages/a's build output changed while it ran");
    });

    it('records no pass under --no-cache when the digest changes mid-run', async () => {
      // The bypass reaches the lookup, not the recording, so the comparison still stands between this run and
      // an entry describing output it never saw.
      writeConfig(repo, log, { command: `echo ran >> ${log} && ${rebuildDigest('digest-from-a-concurrent-build')}` });

      await runNmr(`--no-cache ${COMMAND}`, repo);

      expect(cacheEntryCount()).toBe(0);
    });

    it('settles rather than missing forever once the digest stands still', async () => {
      // The second run rewrites the same digest the first left behind, so its two reads agree and it records.
      writeConfig(repo, log, { command: `echo ran >> ${log} && ${rebuildDigest('digest-from-a-concurrent-build')}` });
      await runNmr(COMMAND, repo);
      await runNmr(COMMAND, repo);

      await runNmr(COMMAND, repo);

      expect(runCount()).toBe(2);
    });
  });

  // region | Helpers

  /** Counts the entries the cache currently holds for the fixture repository. */
  function cacheEntryCount(): number {
    const cacheDir = path.join(repo, 'node_modules', '.cache', 'nmr-check');
    return fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).length : 0;
  }

  /** Returns the lines the fixture's scripts have appended, one per run. */
  function readLog(): string[] {
    if (!fs.existsSync(log)) {
      return [];
    }
    return fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
  }

  /** Renders a shell command standing in for a concurrent build of the fixture's one covered package. */
  function rebuildDigest(digest: string): string {
    return `echo ${digest} > ${resolveBuildCachePath(path.join(repo, 'packages', 'a'))}`;
  }

  /** Counts how many times the fixture's command has actually run. */
  function runCount(): number {
    return readLog().length;
  }

  /**
   * Runs the CLI in-process against the fixture. The check-result-cache variables are stripped from the ambient
   * environment first: this suite may itself be running under `nmr test`, whose snapshot would otherwise reach
   * these invocations and describe a tree that is not the fixture's.
   */
  async function runNmr(
    argString: string,
    cwd: string,
    extraEnv: Record<string, string> = {},
    options: { terminalFd?: number } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const ambient = readAmbientEnv();
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
      args: argString.split(/\s+/).filter((argument) => argument.length > 0),
      cwd,
      env: { ...ambient, ...extraEnv },
      stdout,
      stderr,
    });

    return {
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
      exitCode,
    };
  }

  /** Reads the entry the fixture's runs record for the cacheable command at the repository root. */
  async function readEntry(): Promise<CheckCacheEntry | undefined> {
    return readCheckCacheEntry({ anchorDir: repo, command: COMMAND, monorepoRoot: repo });
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

/**
 * Writes an executable named `nmr` that stands in for the real one, returning the directory to put on `PATH`.
 * A step leading with the `nmr` token has to spawn something that succeeds before a pass can be recorded, and
 * the installed binary is not reliably on the suite's `PATH`.
 */
function writeNmrShim(workspace: string, log: string, output?: string): string {
  const bin = path.join(workspace, 'bin');
  const shim = path.join(bin, 'nmr');
  fs.mkdirSync(bin, { recursive: true });
  const echoOutput = output === undefined ? '' : `echo '${output}'\n`;
  fs.writeFileSync(shim, `#!/bin/sh\necho ran >> ${log}\n${echoOutput}`, { mode: 0o755 });
  return bin;
}

/** Writes the digest a build of `packageDir` would have left beside its output. */
function writeBuildDigest(packageDir: string, digest: string): void {
  const cachePath = resolveBuildCachePath(packageDir);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, digest);
}

/** Runs git in `cwd`, discarding its output. */
function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/**
 * Writes a committed pnpm workspace inside a git repository: one built package, the pnpm files the install
 * fingerprint reads, and a config mapping the cacheable command to a script that appends one line per run.
 */
function scaffoldRepo(repo: string, log: string): void {
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules', '.pnpm'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', '.modules.yaml'), 'hoistPattern:\n  - "types"\n');
  fs.writeFileSync(path.join(repo, 'node_modules', '.pnpm', 'lock.yaml'), 'lockfileVersion: "9.0"\n');

  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\ndist/\n');
  fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'gate-root', private: true }));
  fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const value = 1;\n');

  const packageDir = path.join(repo, 'packages', 'a');
  fs.mkdirSync(path.join(packageDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'dist', 'esm'), { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'a', type: 'module' }));
  fs.writeFileSync(path.join(packageDir, 'src', 'index.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(packageDir, 'dist', 'esm', 'index.js'), 'export const value = 1;\n');
  writeBuildDigest(packageDir, 'digest-from-this-tree');

  writeConfig(repo, log);

  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'fixture@example.com']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--message', 'initial']);
}

/**
 * Writes the fixture's nmr config. Rewriting it after the initial commit changes the tree, which is why each
 * test that needs a different config writes it before its first run rather than between two.
 */
function writeConfig(
  repo: string,
  log: string,
  options: {
    checkCache?: Record<string, unknown>;
    command?: string | string[];
    devBin?: Record<string, string>;
    extraRootScripts?: Record<string, string | string[]>;
  } = {},
): void {
  const config = {
    ...(options.checkCache && { checkCache: options.checkCache }),
    ...(options.devBin && { devBin: options.devBin }),
    rootScripts: {
      [COMMAND]: options.command ?? `echo ran >> ${log}`,
      ...options.extraRootScripts,
    },
  };

  fs.mkdirSync(path.join(repo, '.config'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.config', 'nmr.config.ts'), `export default ${JSON.stringify(config)};\n`);
}

// endregion | Helpers
