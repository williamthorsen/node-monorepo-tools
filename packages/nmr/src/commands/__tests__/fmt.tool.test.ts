import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';

import { captureStdio, createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it as baseIt, vi } from 'vitest';

import { runFmt, runPrettier } from '../fmt.ts';
import { denyAccess, isPrivilegedProcess } from '../test-utils/denyAccess.ts';

/**
 * Tracked fixture files. The root `.prettierignore` mirrors a package pattern the way a repo working
 * around Prettier's flat ignore discovery does; that workaround exists to replace the package-level
 * one.
 */
const TRACKED_FILES = {
  '.prettierignore': 'packages/a/mirrored.js\n',
  'package.json': '{}\n',
  'root.js': 'const root = 1;\n',
  'packages/a/.prettierignore': 'protected.js\n',
  'packages/a/mirrored.js': 'const mirrored = 1;\n',
  'packages/a/protected.js': 'const protectedValue = 1;\n',
};

/** The stand-in for the Prettier CLI, and the file to which it appends one line per invocation. */
const STUB_ENTRY = 'stub.cjs';
const RECORD_ENTRY = 'calls.jsonl';

/**
 * These run the real Prettier, on which the design depends: An ignore file's patterns resolve relative
 * to its own directory, and any explicit `--ignore-path` suppresses working-directory-relative
 * discovery. An assertion on the argument set cannot detect a change in either behavior.
 */
const it = baseIt
  .extend(
    'repositoryTree',
    makeFixture(() => scaffoldRepository(TRACKED_FILES)),
  )
  .extend(
    'stubTree',
    makeFixture(() => scaffoldStub()),
  )
  .extend('cliPath', ({ stubTree }) => stubTree.resolve(STUB_ENTRY))
  // `auto`, because the tests don't name the capture: It exists for its effect on the streams.
  .extend(
    'captured',
    { auto: true },
    makeFixture(() => captureStdio()),
  );

describe(runFmt, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honours a package-level .prettierignore from the repository root', async ({ repositoryTree }) => {
    repositoryTree.write('packages/a/protected.js', 'const  badly   =  1\n');

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(0);
  });

  it('honours a root .prettierignore mirroring a package pattern, so an existing mirror keeps passing', async ({
    repositoryTree,
  }) => {
    repositoryTree.write('packages/a/mirrored.js', 'const  badly   =  1\n');

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(0);
  });

  it('still reports a badly formatted file not covered by any ignore file', async ({ repositoryTree }) => {
    repositoryTree.write('packages/a/unprotected.js', 'const  badly   =  1\n');

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.not.toBe(0);
  });

  it('reaches the same verdict from inside the package as from the repository root', async ({ repositoryTree }) => {
    repositoryTree.write('packages/a/protected.js', 'const  badly   =  1\n');

    await expect(runFmt(['--check'], repositoryTree.resolve('packages/a'))).resolves.toBe(0);
  });

  it('rewrites a badly formatted file in write mode', async ({ repositoryTree }) => {
    repositoryTree.write('packages/a/unprotected.js', 'const  badly   =  1\n');

    await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(0);
    expect(repositoryTree.read('packages/a/unprotected.js')).toBe('const badly = 1;\n');
  });

  it('leaves a file protected by a package-level .prettierignore untouched in write mode', async ({
    repositoryTree,
  }) => {
    repositoryTree.write('packages/a/protected.js', 'const  badly   =  1\n');

    await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(0);
    expect(repositoryTree.read('packages/a/protected.js')).toBe('const  badly   =  1\n');
  });

  it('does not fail on a path deleted from the working tree but still recorded in the index', async ({
    repositoryTree,
  }) => {
    repositoryTree.rm('root.js');

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(0);
  });

  it.skipIf(isPrivilegedProcess)(
    'names a file that it is denied access to, and still checks the rest',
    async ({ captured, repositoryTree }) => {
      using _locked = lockEnvrc(repositoryTree);

      await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(1);
      expect(captured.stderr).toContain('nmr-fmt: skipped locked/.envrc, which cannot be read (EACCES)');
    },
  );

  it.skipIf(isPrivilegedProcess)(
    'names a file that it is denied access to, and still rewrites the rest',
    async ({ captured, repositoryTree }) => {
      using _locked = lockEnvrc(repositoryTree);

      await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(0);
      expect(captured.stderr).toContain('nmr-fmt: skipped locked/.envrc, which cannot be read (EACCES)');
      expect(repositoryTree.read('packages/a/unprotected.js')).toBe('const badly = 1;\n');
    },
  );

  it("fails, naming the path, when a listed file cannot be stat'ed for another reason", async ({
    captured,
    repositoryTree,
  }) => {
    // A loop in a parent component still fails `lstat`, which follows every component but the last.
    repositoryTree.write('loop/x.js', 'const x = 1;\n');
    runGitOrThrow(['add', '--all'], repositoryTree.dir);
    repositoryTree.rm('loop');
    repositoryTree.symlink('loop', 'loop');

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(1);
    expect(captured.stderr).toContain('could not stat loop/x.js');
  });

  it('skips a symlink to a file or a directory in check mode', async ({ repositoryTree }) => {
    trackSymlinks(repositoryTree);

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(0);
  });

  it('skips a symlink to a file or a directory selected by a pathspec', async ({ repositoryTree }) => {
    trackSymlinks(repositoryTree);

    await expect(runFmt(['--check', 'packages'], repositoryTree.dir)).resolves.toBe(0);
  });

  it('leaves a symlink in place in write mode', async ({ repositoryTree }) => {
    trackSymlinks(repositoryTree);

    await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(0);
    expect(lstatSync(repositoryTree.resolve('packages/a/linked.js')).isSymbolicLink()).toBe(true);
  });

  it('constrains the run to the given pathspecs', async ({ repositoryTree }) => {
    repositoryTree.write('root-bad.js', 'const  badly   =  1\n');

    await expect(runFmt(['--check', 'packages'], repositoryTree.dir)).resolves.toBe(0);
  });

  it('fails when the caller named paths that matched nothing', async ({ repositoryTree }) => {
    await expect(runFmt(['--check', 'nothing-matches-this'], repositoryTree.dir)).resolves.toBe(1);
  });

  it('passes quietly when run without pathspecs in a repository that has nothing to format', async () => {
    using empty = createTempTree({}, { prefix: 'nmr-fmt-empty-' });
    runGitOrThrow(['init', '--quiet'], empty.dir);

    await expect(runFmt(['--check'], empty.dir)).resolves.toBe(0);
  });

  it('rejects a bare invocation rather than defaulting to a mutation', async ({ repositoryTree }) => {
    await expect(runFmt([], repositoryTree.dir)).resolves.toBe(1);
  });

  it('rejects an unrecognized option rather than handing it to git as a pathspec', async ({ repositoryTree }) => {
    await expect(runFmt(['--check', '--log-level', 'warn'], repositoryTree.dir)).resolves.toBe(1);
  });

  it("runs the repository's own Prettier when the repository can resolve one", async ({ repositoryTree }) => {
    installStubPrettier(repositoryTree);

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(0);
    expect(readCalls(repositoryTree)).toHaveLength(1);
  });

  it("falls back to nmr's own Prettier when the repository cannot resolve one", async ({ repositoryTree }) => {
    repositoryTree.write('packages/a/unprotected.js', 'const  badly   =  1\n');

    expect(repositoryTree.exists('node_modules')).toBe(false);
    await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(0);
    expect(repositoryTree.read('packages/a/unprotected.js')).toBe('const badly = 1;\n');
  });

  it('formats with the house config, shell scripts included, when the repository does not have a config', async ({
    repositoryTree,
  }) => {
    repositoryTree.write('script.sh', 'echo   hi\n');
    runGitOrThrow(['add', '--all'], repositoryTree.dir);

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.not.toBe(0);
    await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(0);
    expect(repositoryTree.read('script.sh')).toBe('echo hi\n');
  });

  it("formats with the repository's own config when it has one", async ({ repositoryTree }) => {
    repositoryTree.write('.prettierrc', '{ "semi": false }\n');
    repositoryTree.write('packages/a/unprotected.js', 'const  badly   =  1;\n');

    await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(0);
    expect(repositoryTree.read('packages/a/unprotected.js')).toBe('const badly = 1\n');
  });

  it('still applies .editorconfig alongside the house config', async ({ repositoryTree }) => {
    repositoryTree.write('.editorconfig', '[*]\nindent_style = tab\n');
    repositoryTree.write('packages/a/unprotected.js', 'function f() {\n  return 1;\n}\n');

    await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(0);
    expect(repositoryTree.read('packages/a/unprotected.js')).toBe('function f() {\n\treturn 1;\n}\n');
  });

  it('passes the house config only when the repository does not have a config', async ({ repositoryTree }) => {
    installStubPrettier(repositoryTree);

    await runFmt(['--check'], repositoryTree.dir);
    repositoryTree.write('.prettierrc', '{}\n');
    await runFmt(['--check'], repositoryTree.dir);

    const [withoutConfig = [], withConfig = []] = readCalls(repositoryTree);
    expect(withoutConfig).toContain('--config');
    expect(withConfig).not.toContain('--config');
  });

  it('fails outside a git repository rather than reporting a clean run', async () => {
    using outside = createTempTree({}, { prefix: 'nmr-fmt-bare-' });
    // Stop git's upward search at the fixture, so that git cannot find a repository enclosing the temp root.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(outside.dir));

    await expect(runFmt(['--check'], outside.dir)).resolves.toBe(1);
  });
});

/**
 * The argument set handed to Prettier, asserted against a stand-in that records how it was called.
 * `cliPath` is the seam: Production resolves the consuming repository's Prettier through the module
 * graph, and a test substitutes a recorder for it.
 */
describe(runPrettier, () => {
  it('leaves unparseable files to Prettier rather than filtering them out', ({ cliPath, stubTree }) => {
    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir });

    expect(readCalls(stubTree)[0]).toContain('--ignore-unknown');
  });

  it('passes one --ignore-path per discovered ignore file, root-most first', ({ cliPath, stubTree }) => {
    const ignorePaths = ['/repo/.prettierignore', '/repo/packages/a/.prettierignore'];

    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths, cwd: stubTree.dir });

    const args = readCalls(stubTree)[0] ?? [];
    expect(args.filter((_, index) => args[index - 1] === '--ignore-path')).toStrictEqual(ignorePaths);
  });

  it('checks without writing in check mode', ({ cliPath, stubTree }) => {
    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir });

    const args = readCalls(stubTree)[0] ?? [];
    expect(args).toContain('--check');
    expect(args).not.toContain('--write');
  });

  it('names the files that it rewrites in write mode', ({ cliPath, stubTree }) => {
    runPrettier({ cliPath, mode: 'write', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir });

    expect(readCalls(stubTree)[0]).toStrictEqual(expect.arrayContaining(['--list-different', '--write']));
  });

  it("passes Prettier's content-keyed cache when given a cache location", ({ cliPath, stubTree }) => {
    const cacheLocation = '/repo/node_modules/.cache/prettier/nmr-fmt/cache.json';

    runPrettier({ cliPath, cacheLocation, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir });

    expect(readCalls(stubTree)[0]).toStrictEqual(
      expect.arrayContaining(['--cache', '--cache-strategy', 'content', '--cache-location', cacheLocation]),
    );
  });

  it('passes no cache flags without a cache location', ({ cliPath, stubTree }) => {
    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir });

    const args = readCalls(stubTree)[0] ?? [];
    expect(args.filter((arg) => arg.startsWith('--cache'))).toStrictEqual([]);
  });

  it('shares one cache location across every batch', ({ cliPath, stubTree }) => {
    const cacheLocation = '/repo/cache.json';

    runPrettier({
      cliPath,
      cacheLocation,
      mode: 'check',
      files: ['one.js', 'two.js'],
      ignorePaths: [],
      cwd: stubTree.dir,
      budgetBytes: 10,
    });

    const locations = readCalls(stubTree).map((args) => args[args.indexOf('--cache-location') + 1]);
    expect(locations).toStrictEqual([cacheLocation, cacheLocation]);
  });

  it('reports the exit code that Prettier returned', ({ cliPath, stubTree }) => {
    writeRecordingStub(stubTree, 2);

    expect(runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir })).toBe(2);
  });

  it('runs every batch when the selection exceeds the argument budget', ({ cliPath, stubTree }) => {
    // A ten-byte budget puts each of these paths in a batch of its own.
    runPrettier({
      cliPath,
      mode: 'check',
      files: ['one.js', 'two.js', 'six.js'],
      ignorePaths: [],
      cwd: stubTree.dir,
      budgetBytes: 10,
    });

    expect(readCalls(stubTree)).toHaveLength(3);
  });

  it('keeps running after a batch fails, and reports the first failing status', ({ cliPath, stubTree }) => {
    writeRecordingStub(stubTree, 3);

    const exitCode = runPrettier({
      cliPath,
      mode: 'check',
      files: ['one.js', 'two.js'],
      ignorePaths: [],
      cwd: stubTree.dir,
      budgetBytes: 10,
    });

    expect(exitCode).toBe(3);
    expect(readCalls(stubTree)).toHaveLength(2);
  });
});

/**
 * Tracks `locked/.envrc` beside a badly formatted file, then denies access to `locked/`, the state that a
 * sandbox shielding dotfiles produces.
 */
function lockEnvrc(tree: TempTree): Disposable {
  tree.write('locked/.envrc', 'export SECRET=1\n');
  tree.write('packages/a/unprotected.js', 'const  badly   =  1\n');
  runGitOrThrow(['add', '--all'], tree.dir);
  return denyAccess(tree.resolve('locked'));
}

/**
 * Installs a recording stand-in as the repository's own `prettier` package, gitignored so that `nmr-fmt` does
 * not select it for formatting. Its `resolveConfigFile` finds a `.prettierrc` beside the searched path alone.
 */
function installStubPrettier(tree: TempTree): void {
  tree.write('.gitignore', 'node_modules/\n');
  tree.write(
    'node_modules/prettier/package.json',
    `${JSON.stringify({ name: 'prettier', main: 'index.cjs', bin: STUB_ENTRY })}\n`,
  );
  tree.write(
    'node_modules/prettier/index.cjs',
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'exports.resolveConfigFile = async (file) => {',
      "  const candidate = path.join(path.dirname(file), '.prettierrc');",
      '  return fs.existsSync(candidate) ? candidate : null;',
      '};',
      '',
    ].join('\n'),
  );
  writeRecordingStub(tree, 0, 'node_modules/prettier');
}

/** Creates the stub tree containing a recorder that exits 0, which most cases in the block take as given. */
function scaffoldStub(): TempTree {
  const tree = createTempTree({}, { prefix: 'nmr-fmt-stub-' });
  writeRecordingStub(tree, 0);

  return tree;
}

/**
 * Writes a stand-in for the Prettier CLI into `directory` that appends its arguments as one JSON line per
 * invocation to the tree's record.
 */
function writeRecordingStub(tree: TempTree, exitCode: number, directory = '.'): void {
  const source = [
    "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify(tree.resolve(RECORD_ENTRY))}, JSON.stringify(process.argv.slice(2)) + ${JSON.stringify('\n')});`,
    `process.exit(${exitCode});`,
  ].join('\n');
  tree.write(path.join(directory, STUB_ENTRY), `${source}\n`);
}

/** Returns the argument list of each recorded stub invocation, in order. */
function readCalls(tree: TempTree): string[][] {
  if (!tree.exists(RECORD_ENTRY)) return [];

  const calls: string[][] = [];
  for (const line of tree.read(RECORD_ENTRY).split('\n')) {
    if (line === '') continue;
    const parsedLine: unknown = JSON.parse(line);
    if (!Array.isArray(parsedLine)) throw new TypeError(`stub recorded a non-array invocation: ${line}`);
    const args: unknown[] = parsedLine;
    calls.push(args.filter((arg) => typeof arg === 'string'));
  }

  return calls;
}

/**
 * Creates a git repository containing `files`, staged rather than committed: `--cached` reads the
 * index, so staging is enough and the fixture doesn't need a commit identity.
 */
function scaffoldRepository(files: Record<string, string>): TempTree {
  const tree = createTempTree(files, { prefix: 'nmr-fmt-run-' });

  runGitOrThrow(['init', '--quiet'], tree.dir);
  runGitOrThrow(['add', '--all'], tree.dir);

  return tree;
}

/**
 * Tracks a symlink to a file and a symlink to a directory under `packages/a/`, either of which Prettier rejects
 * when named explicitly.
 */
function trackSymlinks(tree: TempTree): void {
  tree.symlink('packages/a/linked.js', 'mirrored.js');
  tree.symlink('packages/a/linked-dir', '..');
  runGitOrThrow(['add', '--all'], tree.dir);
}

/** Runs git for fixture setup, throwing with git's stderr when it fails. */
function runGitOrThrow(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`fixture setup failed: \`git ${args.join(' ')}\` -- ${result.stderr}`);
  }
}
