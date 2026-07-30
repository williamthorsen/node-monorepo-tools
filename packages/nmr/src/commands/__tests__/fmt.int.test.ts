import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runFmt, runPrettier } from '../fmt.ts';

/**
 * Tracked fixture files. The root `.prettierignore` mirrors a package pattern the way a repo working
 * around Prettier's flat ignore discovery does; the package-level one is what that workaround exists
 * to replace.
 */
const TRACKED_FILES = {
  '.prettierignore': 'packages/a/mirrored.js\n',
  'package.json': '{}\n',
  'root.js': 'const root = 1;\n',
  'packages/a/.prettierignore': 'protected.js\n',
  'packages/a/mirrored.js': 'const mirrored = 1;\n',
  'packages/a/protected.js': 'const protectedValue = 1;\n',
};

/**
 * These run the real Prettier, which is what the design depends on: an ignore file's patterns resolve
 * relative to its own directory, and any explicit `--ignore-path` suppresses working-directory-relative
 * discovery. Asserting the argument set cannot detect either of those changing.
 */
describe(runFmt, () => {
  let repository: string;

  beforeEach(() => {
    repository = scaffoldRepository(TRACKED_FILES);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('honours a package-level .prettierignore from the repository root', () => {
    writeFile(repository, 'packages/a/protected.js', 'const  badly   =  1\n');

    expect(runFmt(['--check'], repository)).toBe(0);
  });

  it('honours a root .prettierignore mirroring a package pattern, so an existing mirror keeps passing', () => {
    writeFile(repository, 'packages/a/mirrored.js', 'const  badly   =  1\n');

    expect(runFmt(['--check'], repository)).toBe(0);
  });

  it('still reports a badly formatted file that no ignore file covers', () => {
    writeFile(repository, 'packages/a/unprotected.js', 'const  badly   =  1\n');

    expect(runFmt(['--check'], repository)).not.toBe(0);
  });

  it('reaches the same verdict from inside the package as from the repository root', () => {
    writeFile(repository, 'packages/a/protected.js', 'const  badly   =  1\n');

    expect(runFmt(['--check'], path.join(repository, 'packages', 'a'))).toBe(0);
  });

  it('rewrites a badly formatted file in write mode', () => {
    writeFile(repository, 'packages/a/unprotected.js', 'const  badly   =  1\n');

    expect(runFmt(['--write'], repository)).toBe(0);
    expect(fs.readFileSync(path.join(repository, 'packages/a/unprotected.js'), 'utf8')).toBe('const badly = 1;\n');
  });

  it('leaves a file protected by a package-level .prettierignore untouched in write mode', () => {
    writeFile(repository, 'packages/a/protected.js', 'const  badly   =  1\n');

    expect(runFmt(['--write'], repository)).toBe(0);
    expect(fs.readFileSync(path.join(repository, 'packages/a/protected.js'), 'utf8')).toBe('const  badly   =  1\n');
  });

  it('does not fail on a path deleted from the working tree but still held in the index', () => {
    fs.rmSync(path.join(repository, 'root.js'));

    expect(runFmt(['--check'], repository)).toBe(0);
  });

  it('constrains the run to the given pathspecs', () => {
    writeFile(repository, 'root-bad.js', 'const  badly   =  1\n');

    expect(runFmt(['--check', 'packages'], repository)).toBe(0);
  });

  it('fails when the caller named paths that matched nothing', () => {
    expect(runFmt(['--check', 'nothing-matches-this'], repository)).toBe(1);
  });

  it('passes quietly when a repository with no pathspecs has nothing to format', () => {
    const empty = makeTempDir('nmr-fmt-empty-');
    runGitOrThrow(['init', '--quiet'], empty);

    expect(runFmt(['--check'], empty)).toBe(0);

    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('rejects a bare invocation rather than defaulting to a mutation', () => {
    expect(runFmt([], repository)).toBe(1);
  });

  it('rejects an unrecognized option rather than handing it to git as a pathspec', () => {
    expect(runFmt(['--check', '--log-level', 'warn'], repository)).toBe(1);
  });

  it('fails outside a git repository rather than reporting a clean run', () => {
    const outside = makeTempDir('nmr-fmt-bare-');

    expect(runFmt(['--check'], outside)).toBe(1);

    fs.rmSync(outside, { recursive: true, force: true });
  });
});

/**
 * The argument set handed to Prettier, asserted against a stand-in that records how it was called.
 * `cliPath` is the seam: production resolves the consuming repository's Prettier through the module
 * graph, and a test substitutes a recorder for it.
 */
describe(runPrettier, () => {
  let stubDir: string;
  let cliPath: string;
  let recordPath: string;

  beforeEach(() => {
    stubDir = makeTempDir('nmr-fmt-stub-');
    cliPath = path.join(stubDir, 'stub.cjs');
    recordPath = path.join(stubDir, 'calls.jsonl');
    writeRecordingStub(cliPath, recordPath, 0);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    fs.rmSync(stubDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('leaves unparseable files to Prettier rather than filtering them out', () => {
    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubDir });

    expect(readCalls(recordPath)[0]).toContain('--ignore-unknown');
  });

  it('passes one --ignore-path per discovered ignore file, root-most first', () => {
    const ignorePaths = ['/repo/.prettierignore', '/repo/packages/a/.prettierignore'];

    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths, cwd: stubDir });

    const args = readCalls(recordPath)[0] ?? [];
    expect(args.filter((_, index) => args[index - 1] === '--ignore-path')).toStrictEqual(ignorePaths);
  });

  it('checks without writing in check mode', () => {
    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubDir });

    const args = readCalls(recordPath)[0] ?? [];
    expect(args).toContain('--check');
    expect(args).not.toContain('--write');
  });

  it('names the files it rewrites in write mode', () => {
    runPrettier({ cliPath, mode: 'write', files: ['a.js'], ignorePaths: [], cwd: stubDir });

    expect(readCalls(recordPath)[0]).toEqual(expect.arrayContaining(['--list-different', '--write']));
  });

  it('reports the exit code Prettier returned', () => {
    writeRecordingStub(cliPath, recordPath, 2);

    expect(runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubDir })).toBe(2);
  });

  it('runs every batch when the selection exceeds the argument budget', () => {
    // A ten-byte budget puts each of these paths in a batch of its own.
    runPrettier({
      cliPath,
      mode: 'check',
      files: ['one.js', 'two.js', 'six.js'],
      ignorePaths: [],
      cwd: stubDir,
      budgetBytes: 10,
    });

    expect(readCalls(recordPath)).toHaveLength(3);
  });

  it('keeps running after a batch fails, and reports the first failing status', () => {
    writeRecordingStub(cliPath, recordPath, 3);

    const exitCode = runPrettier({
      cliPath,
      mode: 'check',
      files: ['one.js', 'two.js'],
      ignorePaths: [],
      cwd: stubDir,
      budgetBytes: 10,
    });

    expect(exitCode).toBe(3);
    expect(readCalls(recordPath)).toHaveLength(2);
  });
});

/** Writes a stand-in for the Prettier CLI that appends its arguments as one JSON line per invocation. */
function writeRecordingStub(cliPath: string, recordPath: string, exitCode: number): void {
  const source = [
    "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.argv.slice(2)) + ${JSON.stringify('\n')});`,
    `process.exit(${exitCode});`,
  ].join('\n');
  fs.writeFileSync(cliPath, `${source}\n`);
}

function readCalls(recordPath: string): string[][] {
  if (!fs.existsSync(recordPath)) return [];

  const calls: string[][] = [];
  for (const line of fs.readFileSync(recordPath, 'utf8').split('\n')) {
    if (line === '') continue;
    const parsed: unknown = JSON.parse(line);
    if (!Array.isArray(parsed)) throw new TypeError(`stub recorded a non-array invocation: ${line}`);
    const args: unknown[] = parsed;
    calls.push(args.filter((arg) => typeof arg === 'string'));
  }

  return calls;
}

/**
 * Creates a git repository holding `files`, staged rather than committed: `--cached` reads the index,
 * so staging is enough and the fixture needs no commit identity.
 */
function scaffoldRepository(files: Record<string, string>): string {
  const dir = makeTempDir('nmr-fmt-run-');

  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(dir, relativePath, contents);
  }

  runGitOrThrow(['init', '--quiet'], dir);
  runGitOrThrow(['add', '--all'], dir);

  return dir;
}

function writeFile(dir: string, relativePath: string, contents: string): void {
  const filePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

/**
 * Creates a temp directory and resolves it through `realpath`, because macOS exposes the temp root
 * through a symlink while `git rev-parse --show-toplevel` reports the resolved path.
 */
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return fs.realpathSync(dir);
}

function runGitOrThrow(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`fixture setup failed: \`git ${args.join(' ')}\` -- ${result.stderr}`);
  }
}
