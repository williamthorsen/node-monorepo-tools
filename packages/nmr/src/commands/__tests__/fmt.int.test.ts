import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runFmt } from '../fmt.ts';

/**
 * Tracked fixture files, mirroring the resolver suite: one package-level `.prettierignore` to be
 * discovered from the repository root, and one plain file to be formatted.
 */
const TRACKED_FILES = {
  'package.json': '{}\n',
  'root.js': 'const root = 1;\n',
  'packages/a/.prettierignore': 'protected.js\n',
  'packages/a/protected.js': 'const protectedValue = 1;\n',
};

describe(runFmt, () => {
  let repository: string;
  let stubDir: string;
  let recordPath: string;

  beforeEach(() => {
    repository = scaffoldRepository(TRACKED_FILES);
    stubDir = makeTempDir('nmr-fmt-stub-');
    recordPath = path.join(stubDir, 'argv.txt');
    // Prettier is not a dependency of this package, so the assertions run against a stub that records
    // how it was called. What matters here is the argument set, which is what the real binary consumes.
    writePrettierStub(stubDir, recordPath, 0);
    vi.stubEnv('PATH', `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
    fs.rmSync(stubDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('passes every selected file to Prettier, relative to the working directory', () => {
    const exitCode = runFmt(['--check'], repository);

    expect(exitCode).toBe(0);
    expect(readRecordedArgs(recordPath)).toEqual(
      expect.arrayContaining(['package.json', 'root.js', 'packages/a/protected.js']),
    );
  });

  it('leaves unparseable files to Prettier rather than filtering them out', () => {
    runFmt(['--check'], repository);

    expect(readRecordedArgs(recordPath)).toContain('--ignore-unknown');
  });

  it('passes the repository-root .prettierignore and every package-level one', () => {
    runFmt(['--check'], repository);

    expect(readRecordedIgnorePaths(recordPath)).toStrictEqual([
      path.join(repository, '.prettierignore'),
      path.join(repository, 'packages/a/.prettierignore'),
    ]);
  });

  it('discovers the same ignore files when run from inside a package', () => {
    runFmt(['--check'], path.join(repository, 'packages', 'a'));

    expect(readRecordedIgnorePaths(recordPath)).toStrictEqual([
      path.join(repository, '.prettierignore'),
      path.join(repository, 'packages/a/.prettierignore'),
    ]);
  });

  it('names the files it rewrites in write mode', () => {
    runFmt(['--write'], repository);

    expect(readRecordedArgs(recordPath)).toEqual(expect.arrayContaining(['--list-different', '--write']));
  });

  it('constrains the selection to the given pathspecs', () => {
    runFmt(['--check', 'packages/a'], repository);

    expect(readRecordedArgs(recordPath)).not.toContain('root.js');
  });

  it('reports the exit code Prettier returned', () => {
    writePrettierStub(stubDir, recordPath, 1);

    expect(runFmt(['--check'], repository)).toBe(1);
  });

  it('does not run Prettier when the selection is empty', () => {
    const exitCode = runFmt(['--check', 'nothing-matches-this'], repository);

    expect(exitCode).toBe(0);
    expect(fs.existsSync(recordPath)).toBe(false);
  });

  it('rejects a bare invocation rather than defaulting to a mutation', () => {
    expect(runFmt([], repository)).toBe(1);
    expect(fs.existsSync(recordPath)).toBe(false);
  });

  it('rejects an unrecognized option rather than handing it to git as a pathspec', () => {
    expect(runFmt(['--check', '--log-level', 'warn'], repository)).toBe(1);
    expect(fs.existsSync(recordPath)).toBe(false);
  });

  it('fails outside a git repository rather than reporting a clean run', () => {
    const outside = makeTempDir('nmr-fmt-bare-');

    expect(runFmt(['--check'], outside)).toBe(1);
    expect(fs.existsSync(recordPath)).toBe(false);

    fs.rmSync(outside, { recursive: true, force: true });
  });
});

/** Writes an executable stand-in for Prettier that records its arguments and exits with `exitCode`. */
function writePrettierStub(dir: string, recordPath: string, exitCode: number): void {
  const stubPath = path.join(dir, 'prettier');
  fs.writeFileSync(stubPath, `#!/bin/sh\nprintf '%s\\n' "$@" > '${recordPath}'\nexit ${exitCode}\n`);
  fs.chmodSync(stubPath, 0o755);
}

/** Reads back the value of every `--ignore-path` flag, in the order Prettier received them. */
function readRecordedIgnorePaths(recordPath: string): string[] {
  const args = readRecordedArgs(recordPath);
  return args.filter((_, index) => args[index - 1] === '--ignore-path');
}

function readRecordedArgs(recordPath: string): string[] {
  return fs
    .readFileSync(recordPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

/**
 * Creates a git repository holding `files`, staged rather than committed: `--cached` reads the index,
 * so staging is enough and the fixture needs no commit identity.
 */
function scaffoldRepository(files: Record<string, string>): string {
  const dir = makeTempDir('nmr-fmt-run-');

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  runGitOrThrow(['init', '--quiet'], dir);
  runGitOrThrow(['add', '--all'], dir);

  return dir;
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
