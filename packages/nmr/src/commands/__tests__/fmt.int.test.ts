import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isObject } from '../../helpers/type-guards.ts';
import { runFmt, runPrettier } from '../fmt.ts';

/**
 * Tracked fixture files, mirroring the resolver suite: one package-level `.prettierignore` to be
 * discovered from the repository root, and one plain file to be formatted.
 */
const TRACKED_FILES = {
  '.prettierignore': 'packages/a/mirrored.js\n',
  'package.json': '{}\n',
  'root.js': 'const root = 1;\n',
  'packages/a/.prettierignore': 'protected.js\n',
  'packages/a/mirrored.js': 'const mirrored = 1;\n',
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
    // These cases assert the exact argument set Prettier receives, so a stub recording its argv is the
    // subject; the real binary is exercised separately, for the semantics that argument set relies on.
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

  it('fails when the caller named paths that matched nothing', () => {
    const exitCode = runFmt(['--check', 'nothing-matches-this'], repository);

    expect(exitCode).toBe(1);
    expect(fs.existsSync(recordPath)).toBe(false);
  });

  it('passes quietly when a repository with no pathspecs has nothing to format', () => {
    const empty = makeTempDir('nmr-fmt-empty-');
    runGitOrThrow(['init', '--quiet'], empty);

    const exitCode = runFmt(['--check'], empty);

    expect(exitCode).toBe(0);
    expect(fs.existsSync(recordPath)).toBe(false);

    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('does not hand Prettier a path deleted from the working tree', () => {
    fs.rmSync(path.join(repository, 'root.js'));

    const exitCode = runFmt(['--check'], repository);

    expect(exitCode).toBe(0);
    expect(readRecordedArgs(recordPath)).not.toContain('root.js');
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

/**
 * These run the real Prettier, not the stub. The whole change rests on two behaviors nmr does not
 * control -- an ignore file's patterns resolve relative to its own directory, and any explicit
 * `--ignore-path` suppresses working-directory-relative discovery -- and asserting the argument set
 * cannot detect either one changing.
 */
describe('runFmt against the real Prettier', () => {
  let repository: string;
  let binDir: string;

  beforeEach(() => {
    repository = scaffoldRepository({ 'package.json': '{}\n' });
    binDir = linkPrettierBin();
    vi.stubEnv('PATH', `${binDir}${path.delimiter}${process.env.PATH ?? ''}`);
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('honours a package-level .prettierignore from the repository root', () => {
    writeFile(repository, 'packages/a/.prettierignore', 'protected.js\n');
    writeFile(repository, 'packages/a/protected.js', 'const  badly   =  1\n');
    runGitOrThrow(['add', '--all'], repository);

    expect(runFmt(['--check'], repository)).toBe(0);
  });

  it('honours a root .prettierignore that mirrors a package pattern, so an existing mirror keeps passing', () => {
    writeFile(repository, '.prettierignore', 'packages/a/mirrored.js\n');
    writeFile(repository, 'packages/a/mirrored.js', 'const  badly   =  1\n');
    runGitOrThrow(['add', '--all'], repository);

    expect(runFmt(['--check'], repository)).toBe(0);
  });

  it('still reports a badly formatted file that no ignore file covers', () => {
    writeFile(repository, 'packages/a/unprotected.js', 'const  badly   =  1\n');
    runGitOrThrow(['add', '--all'], repository);

    expect(runFmt(['--check'], repository)).not.toBe(0);
  });
});

describe(runPrettier, () => {
  let stubDir: string;
  let tallyPath: string;

  beforeEach(() => {
    stubDir = makeTempDir('nmr-fmt-batch-');
    tallyPath = path.join(stubDir, 'tally.txt');
    vi.stubEnv('PATH', `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    fs.rmSync(stubDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('runs every batch when the selection exceeds the argument budget', () => {
    writeTallyingStub(stubDir, tallyPath, 0);

    // A budget of 10 bytes puts each of these paths in its own batch.
    runPrettier('check', ['one.js', 'two.js', 'six.js'], [], stubDir, 10);

    expect(countInvocations(tallyPath)).toBe(3);
  });

  it('keeps running after a batch fails, and reports the first failing status', () => {
    writeTallyingStub(stubDir, tallyPath, 3);

    const exitCode = runPrettier('check', ['one.js', 'two.js'], [], stubDir, 10);

    expect(exitCode).toBe(3);
    expect(countInvocations(tallyPath)).toBe(2);
  });
});

/**
 * Exposes the installed Prettier CLI as a directory holding a `prettier` executable, so a spawn that
 * resolves from `PATH` finds it regardless of how the package manager laid out `node_modules/.bin`.
 */
function linkPrettierBin(): string {
  const manifestPath = createRequire(import.meta.url).resolve('prettier/package.json');
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!isObject(manifest) || typeof manifest.bin !== 'string') {
    throw new TypeError(`Prettier's package.json does not declare a single bin path: ${manifestPath}`);
  }
  const cliPath = path.resolve(path.dirname(manifestPath), manifest.bin);

  const dir = makeTempDir('nmr-fmt-prettier-');
  fs.symlinkSync(cliPath, path.join(dir, 'prettier'));

  return dir;
}

/** Writes an executable stand-in for Prettier that appends one line per invocation and exits with `exitCode`. */
function writeTallyingStub(dir: string, tallyPath: string, exitCode: number): void {
  const stubPath = path.join(dir, 'prettier');
  fs.writeFileSync(stubPath, `#!/bin/sh\necho ran >> '${tallyPath}'\nexit ${exitCode}\n`);
  fs.chmodSync(stubPath, 0o755);
}

function countInvocations(tallyPath: string): number {
  if (!fs.existsSync(tallyPath)) return 0;
  return fs
    .readFileSync(tallyPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '').length;
}

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
