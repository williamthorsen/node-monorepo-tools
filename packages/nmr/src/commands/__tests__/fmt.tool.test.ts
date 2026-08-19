import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, test } from 'vitest';

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
const it = test
  .extend(
    'repositoryTree',
    makeFixture(() => scaffoldRepository(TRACKED_FILES)),
  )
  .extend(
    'stubTree',
    makeFixture(() => scaffoldStub()),
  )
  .extend('cliPath', ({ stubTree }) => path.join(stubTree.dir, 'stub.cjs'))
  .extend('recordPath', ({ stubTree }) => path.join(stubTree.dir, 'calls.jsonl'))
  // `auto`, because no test names the capture: it exists for its effect on the streams.
  .extend(
    'captured',
    { auto: true },
    makeFixture(() => captureStdio()),
  );

describe(runFmt, () => {
  it('honours a package-level .prettierignore from the repository root', ({ repositoryTree }) => {
    writeFile(repositoryTree.dir, 'packages/a/protected.js', 'const  badly   =  1\n');

    expect(runFmt(['--check'], repositoryTree.dir)).toBe(0);
  });

  it('honours a root .prettierignore mirroring a package pattern, so an existing mirror keeps passing', ({
    repositoryTree,
  }) => {
    writeFile(repositoryTree.dir, 'packages/a/mirrored.js', 'const  badly   =  1\n');

    expect(runFmt(['--check'], repositoryTree.dir)).toBe(0);
  });

  it('still reports a badly formatted file that no ignore file covers', ({ repositoryTree }) => {
    writeFile(repositoryTree.dir, 'packages/a/unprotected.js', 'const  badly   =  1\n');

    expect(runFmt(['--check'], repositoryTree.dir)).not.toBe(0);
  });

  it('reaches the same verdict from inside the package as from the repository root', ({ repositoryTree }) => {
    writeFile(repositoryTree.dir, 'packages/a/protected.js', 'const  badly   =  1\n');

    expect(runFmt(['--check'], path.join(repositoryTree.dir, 'packages', 'a'))).toBe(0);
  });

  it('rewrites a badly formatted file in write mode', ({ repositoryTree }) => {
    writeFile(repositoryTree.dir, 'packages/a/unprotected.js', 'const  badly   =  1\n');

    expect(runFmt(['--write'], repositoryTree.dir)).toBe(0);
    expect(fs.readFileSync(path.join(repositoryTree.dir, 'packages/a/unprotected.js'), 'utf8')).toBe(
      'const badly = 1;\n',
    );
  });

  it('leaves a file protected by a package-level .prettierignore untouched in write mode', ({ repositoryTree }) => {
    writeFile(repositoryTree.dir, 'packages/a/protected.js', 'const  badly   =  1\n');

    expect(runFmt(['--write'], repositoryTree.dir)).toBe(0);
    expect(fs.readFileSync(path.join(repositoryTree.dir, 'packages/a/protected.js'), 'utf8')).toBe(
      'const  badly   =  1\n',
    );
  });

  it('does not fail on a path deleted from the working tree but still held in the index', ({ repositoryTree }) => {
    fs.rmSync(path.join(repositoryTree.dir, 'root.js'));

    expect(runFmt(['--check'], repositoryTree.dir)).toBe(0);
  });

  it('constrains the run to the given pathspecs', ({ repositoryTree }) => {
    writeFile(repositoryTree.dir, 'root-bad.js', 'const  badly   =  1\n');

    expect(runFmt(['--check', 'packages'], repositoryTree.dir)).toBe(0);
  });

  it('fails when the caller named paths that matched nothing', ({ repositoryTree }) => {
    expect(runFmt(['--check', 'nothing-matches-this'], repositoryTree.dir)).toBe(1);
  });

  it('passes quietly when a repository with no pathspecs has nothing to format', () => {
    using empty = createTempTree({}, { prefix: 'nmr-fmt-empty-' });
    runGitOrThrow(['init', '--quiet'], empty.dir);

    expect(runFmt(['--check'], empty.dir)).toBe(0);
  });

  it('rejects a bare invocation rather than defaulting to a mutation', ({ repositoryTree }) => {
    expect(runFmt([], repositoryTree.dir)).toBe(1);
  });

  it('rejects an unrecognized option rather than handing it to git as a pathspec', ({ repositoryTree }) => {
    expect(runFmt(['--check', '--log-level', 'warn'], repositoryTree.dir)).toBe(1);
  });

  it('fails outside a git repository rather than reporting a clean run', () => {
    using outside = createTempTree({}, { prefix: 'nmr-fmt-bare-' });

    expect(runFmt(['--check'], outside.dir)).toBe(1);
  });
});

/**
 * The argument set handed to Prettier, asserted against a stand-in that records how it was called.
 * `cliPath` is the seam: production resolves the consuming repository's Prettier through the module
 * graph, and a test substitutes a recorder for it.
 */
describe(runPrettier, () => {
  it('leaves unparseable files to Prettier rather than filtering them out', ({ cliPath, recordPath, stubTree }) => {
    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir });

    expect(readCalls(recordPath)[0]).toContain('--ignore-unknown');
  });

  it('passes one --ignore-path per discovered ignore file, root-most first', ({ cliPath, recordPath, stubTree }) => {
    const ignorePaths = ['/repo/.prettierignore', '/repo/packages/a/.prettierignore'];

    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths, cwd: stubTree.dir });

    const args = readCalls(recordPath)[0] ?? [];
    expect(args.filter((_, index) => args[index - 1] === '--ignore-path')).toStrictEqual(ignorePaths);
  });

  it('checks without writing in check mode', ({ cliPath, recordPath, stubTree }) => {
    runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir });

    const args = readCalls(recordPath)[0] ?? [];
    expect(args).toContain('--check');
    expect(args).not.toContain('--write');
  });

  it('names the files it rewrites in write mode', ({ cliPath, recordPath, stubTree }) => {
    runPrettier({ cliPath, mode: 'write', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir });

    expect(readCalls(recordPath)[0]).toStrictEqual(expect.arrayContaining(['--list-different', '--write']));
  });

  it('reports the exit code Prettier returned', ({ cliPath, recordPath, stubTree }) => {
    writeRecordingStub(cliPath, recordPath, 2);

    expect(runPrettier({ cliPath, mode: 'check', files: ['a.js'], ignorePaths: [], cwd: stubTree.dir })).toBe(2);
  });

  it('runs every batch when the selection exceeds the argument budget', ({ cliPath, recordPath, stubTree }) => {
    // A ten-byte budget puts each of these paths in a batch of its own.
    runPrettier({
      cliPath,
      mode: 'check',
      files: ['one.js', 'two.js', 'six.js'],
      ignorePaths: [],
      cwd: stubTree.dir,
      budgetBytes: 10,
    });

    expect(readCalls(recordPath)).toHaveLength(3);
  });

  it('keeps running after a batch fails, and reports the first failing status', ({ cliPath, recordPath, stubTree }) => {
    writeRecordingStub(cliPath, recordPath, 3);

    const exitCode = runPrettier({
      cliPath,
      mode: 'check',
      files: ['one.js', 'two.js'],
      ignorePaths: [],
      cwd: stubTree.dir,
      budgetBytes: 10,
    });

    expect(exitCode).toBe(3);
    expect(readCalls(recordPath)).toHaveLength(2);
  });
});

/** Writes a stand-in for the Prettier CLI that appends its arguments as one JSON line per invocation. */
/** Creates the stub tree carrying a recorder that exits 0, which most cases in the block take as given. */
function scaffoldStub(): TempTree {
  const tree = createTempTree({}, { prefix: 'nmr-fmt-stub-' });
  writeRecordingStub(path.join(tree.dir, 'stub.cjs'), path.join(tree.dir, 'calls.jsonl'), 0);

  return tree;
}

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
function scaffoldRepository(files: Record<string, string>): TempTree {
  const tree = createTempTree({}, { prefix: 'nmr-fmt-run-' });

  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(tree.dir, relativePath, contents);
  }

  runGitOrThrow(['init', '--quiet'], tree.dir);
  runGitOrThrow(['add', '--all'], tree.dir);

  return tree;
}

function writeFile(dir: string, relativePath: string, contents: string): void {
  const filePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runGitOrThrow(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`fixture setup failed: \`git ${args.join(' ')}\` -- ${result.stderr}`);
  }
}
