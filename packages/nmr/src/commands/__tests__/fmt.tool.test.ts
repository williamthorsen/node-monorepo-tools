import type { SpawnSyncOptions } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { captureStdio, createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { runFmt } from '../fmt.ts';
import { FMT_CACHE_DIRECTORY, prepareFmtCache } from '../fmt-cache.ts';
import { addSubmodule } from '../test-utils/addSubmodule.ts';
import { denyAccess, isPrivilegedProcess } from '../test-utils/denyAccess.ts';
import { runGitOrThrow } from '../test-utils/runGitOrThrow.ts';

// Prettier's child inherits the worker's descriptors, which no in-process capture reaches. Piping its output and
// writing it to the process streams hands it to the `captured` fixture; stdout and stderr lose their interleaving.
vi.mock(import('node:child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // An untyped mock, because one implementation cannot satisfy every `spawnSync` overload.
    spawnSync: vi.fn().mockImplementation((command: string, args: readonly string[], options: SpawnSyncOptions) => {
      if (options.stdio !== 'inherit') return actual.spawnSync(command, args, options);

      const result = actual.spawnSync(command, args, { ...options, stdio: ['inherit', 'pipe', 'pipe'] });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return result;
    }),
  };
});

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

/** Source that Prettier rewrites under any config. */
const BADLY_FORMATTED = 'const  badly   =  1\n';

/** A file name that Prettier reads as a cluster of short flags unless `--` precedes it. */
const DASH_LEADING_FILE = '-lead.js';

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
    'cachedTree',
    makeFixture(() => scaffoldCachedRepository()),
  )
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

  it.for(['--check', '--write'])(
    'passes in %s mode when every named path is a symlink, naming each one',
    async (mode, { captured, repositoryTree }) => {
      trackSymlinks(repositoryTree);

      await expect(runFmt([mode, 'packages/a/linked.js', 'packages/a/linked-dir'], repositoryTree.dir)).resolves.toBe(
        0,
      );
      expect(captured.stderr).toContain(
        'nmr-fmt: nothing to format; skipped paths that are not regular files: packages/a/linked-dir, packages/a/linked.js',
      );
    },
  );

  it('passes when the only named path is a submodule gitlink', async ({ repositoryTree }) => {
    addSubmodule(repositoryTree, 'vendor/sub');

    await expect(runFmt(['--check', 'vendor/sub'], repositoryTree.dir)).resolves.toBe(0);
  });

  it('fails when the caller named paths that matched nothing', async ({ captured, repositoryTree }) => {
    await expect(runFmt(['--check', 'nothing-matches-this'], repositoryTree.dir)).resolves.toBe(1);
    expect(captured.stderr).toBe(
      'nmr-fmt: the pathspecs did not match any file that git lists: nothing-matches-this\n',
    );
  });

  it('passes quietly when run without pathspecs in a repository that has nothing to format', async () => {
    using empty = createTempTree({}, { prefix: 'nmr-fmt-empty-' });
    runGitOrThrow(['init', '--quiet'], empty.dir);

    await expect(runFmt(['--check'], empty.dir)).resolves.toBe(0);
  });

  it('rejects a bare invocation rather than defaulting to a mutation', async ({ captured, repositoryTree }) => {
    await expect(runFmt([], repositoryTree.dir)).resolves.toBe(2);
    expect(captured.stderr).toBe("nmr-fmt: Pass --check or --write.\nTry 'nmr-fmt --help'.\n");
  });

  it('rejects both modes at once', async ({ captured, repositoryTree }) => {
    await expect(runFmt(['--check', '--write'], repositoryTree.dir)).resolves.toBe(2);
    expect(captured.stderr).toContain('Pass --check or --write, not both.');
  });

  it('rejects an unrecognized option rather than handing it to git as a pathspec', async ({ repositoryTree }) => {
    await expect(runFmt(['--check', '--log-level', 'warn'], repositoryTree.dir)).resolves.toBe(2);
  });

  it('rejects an unrecognized option that comes before --', async ({ repositoryTree }) => {
    await expect(runFmt(['--check', '--bogus', '--', 'packages'], repositoryTree.dir)).resolves.toBe(2);
  });

  it('constrains the run to the pathspecs after --', async ({ repositoryTree }) => {
    repositoryTree.write('root-bad.js', 'const  badly   =  1\n');

    await expect(runFmt(['--check', '--', 'packages'], repositoryTree.dir)).resolves.toBe(0);
  });

  it('reads every argument after -- as a pathspec, a mode flag included', async ({ captured, repositoryTree }) => {
    await expect(runFmt(['--', '--check'], repositoryTree.dir)).resolves.toBe(2);
    expect(captured.stderr).toContain('Pass --check or --write.');
  });

  it('checks a file whose name starts with - when a pathspec after -- selects it', async ({
    captured,
    repositoryTree,
  }) => {
    trackDashLeadingFile(repositoryTree);

    await expect(runFmt(['--check', '--', DASH_LEADING_FILE], repositoryTree.dir)).resolves.toBe(1);
    // Strip the color that Prettier adds to its log tags when the environment forces it, as CI does.
    expect(stripVTControlCharacters(captured.stderr)).toContain(`[warn] ${DASH_LEADING_FILE}`);
  });

  it.for([
    { label: 'a pathspec after --', argv: ['--write', '--', DASH_LEADING_FILE] },
    { label: 'a run without pathspecs', argv: ['--write'] },
  ])('writes a file whose name starts with - when selected by $label', async ({ argv }, { repositoryTree }) => {
    trackDashLeadingFile(repositoryTree);

    await expect(runFmt(argv, repositoryTree.dir)).resolves.toBe(0);
    expect(repositoryTree.read(DASH_LEADING_FILE)).toBe('const badly = 1;\n');
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

  it("fails, naming the manifest, rather than falling back to nmr's Prettier when the repository's is broken", async ({
    captured,
    repositoryTree,
  }) => {
    installRepositoryPrettierManifest(repositoryTree, '{\n');

    await expect(runFmt(['--write'], repositoryTree.dir)).resolves.toBe(1);
    // An unchanged file shows that nmr's own Prettier did not format in the broken copy's place.
    expect(repositoryTree.read('packages/a/unprotected.js')).toBe(BADLY_FORMATTED);
    expect(captured.stderr).toContain(
      `nmr-fmt: \`prettier\` could not be loaded from this repository: Invalid package config ${repositoryTree.resolve('node_modules/prettier/package.json')}`,
    );
    expect(captured.stderr).toContain('Repair that manifest, or reinstall the package that contains it.');
  });

  it("names the repository's reinstall step when its Prettier manifest does not declare a CLI", async ({
    captured,
    repositoryTree,
  }) => {
    installRepositoryPrettierManifest(repositoryTree, '{"name":"prettier"}\n');

    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(1);
    expect(captured.stderr).toContain(
      `nmr-fmt: \`prettier\` at ${repositoryTree.resolve('node_modules/prettier')} does not declare a CLI. Reinstall this repository's \`prettier\` dependency.`,
    );
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

describe('runFmt with the Prettier cache', () => {
  beforeEach(() => {
    // An outer `nmr --no-cache` exports the bypass to the test run, which would disable the cache under test.
    vi.stubEnv('NMR_NO_CACHE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps one cache file per scope under the repository root', async ({ cachedTree }) => {
    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
    const [rootFile] = listCacheFiles(cachedTree);
    await expect(runFmt(['--check'], cachedTree.resolve('packages/a'))).resolves.toBe(0);

    expect(rootFile).toBeDefined();
    expect(listCacheFiles(cachedTree)).toHaveLength(2);
  });

  it('keeps the cache file that Prettier wrote for the next run', async ({ cachedTree }) => {
    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
    const [cacheFile = ''] = listCacheFiles(cachedTree);
    const written = cachedTree.read(path.join(FMT_CACHE_DIRECTORY, cacheFile));

    const prepared = prepareFmtCache({
      cwd: cachedTree.dir,
      env: {},
      repositoryRoot: realpathSync(cachedTree.dir),
      shouldBypassCache: false,
    });

    expect(prepared).toStrictEqual({
      kind: 'cached',
      location: realpathSync(cachedTree.resolve(FMT_CACHE_DIRECTORY, cacheFile)),
    });
    expect(cachedTree.read(path.join(FMT_CACHE_DIRECTORY, cacheFile))).toBe(written);
  });

  it('does not select its own cache files for formatting, although node_modules is not ignored', async ({
    cachedTree,
  }) => {
    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);

    // git lists the untracked cache file, and the second check passes only because Prettier skips `node_modules`.
    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
  });

  it('still fails on a file misformatted after a cached pass', async ({ cachedTree }) => {
    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
    cachedTree.write('root.js', 'const  root =  1\n');

    await expect(runFmt(['--check'], cachedTree.dir)).resolves.not.toBe(0);
  });

  it('fails on files that a changed Prettier config no longer accepts', async ({ cachedTree }) => {
    cachedTree.write('.prettierrc', '{ "singleQuote": true }\n');
    cachedTree.write('quoted.js', "const quoted = 'x';\n");
    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);

    cachedTree.write('.prettierrc', '{ "singleQuote": false }\n');

    await expect(runFmt(['--check'], cachedTree.dir)).resolves.not.toBe(0);
  });

  it('replaces the cache file when the lockfile changes', async ({ cachedTree }) => {
    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
    const before = listCacheFiles(cachedTree);
    cachedTree.write('pnpm-lock.yaml', "lockfileVersion: '9.1'\n");

    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);

    const after = listCacheFiles(cachedTree);
    expect(after).toHaveLength(1);
    expect(after).not.toStrictEqual(before);
  });

  it('replaces a corrupt cache file rather than failing the run', async ({ cachedTree }) => {
    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
    const [cacheFile = ''] = listCacheFiles(cachedTree);
    cachedTree.write(path.join(FMT_CACHE_DIRECTORY, cacheFile), '{"truncated');

    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
    expect(() => cachedTree.readJson(path.join(FMT_CACHE_DIRECTORY, cacheFile))).not.toThrow();
  });

  it('runs uncached, with a warning, when the cache cannot be prepared', async ({ cachedTree, captured }) => {
    // A file where the cache directory belongs makes creating the directory fail.
    cachedTree.write(FMT_CACHE_DIRECTORY, '');

    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
    expect(captured.stderr).toContain('nmr-fmt: running without the Prettier cache:');
  });

  it('bypasses the cache when given --no-cache', async ({ cachedTree }) => {
    await expect(runFmt(['--write', '--no-cache'], cachedTree.dir)).resolves.toBe(0);

    expect(listCacheFiles(cachedTree)).toStrictEqual([]);
  });

  it('bypasses the cache when NMR_NO_CACHE is set', async ({ cachedTree }) => {
    vi.stubEnv('NMR_NO_CACHE', '1');

    await expect(runFmt(['--check'], cachedTree.dir)).resolves.toBe(0);
    expect(listCacheFiles(cachedTree)).toStrictEqual([]);
  });

  it('runs uncached in a repository whose root does not contain node_modules', async ({ repositoryTree }) => {
    await expect(runFmt(['--check'], repositoryTree.dir)).resolves.toBe(0);

    expect(repositoryTree.exists('node_modules')).toBe(false);
  });
});

// region | Helpers

/** Installs a repository Prettier whose manifest is `manifest`, beside a tracked, badly formatted file. */
function installRepositoryPrettierManifest(tree: TempTree, manifest: string): void {
  tree.write('.gitignore', 'node_modules/\n');
  tree.write('node_modules/prettier/package.json', manifest);
  tree.write('packages/a/unprotected.js', BADLY_FORMATTED);
  runGitOrThrow(['add', '--all'], tree.dir);
}

/**
 * Installs a stand-in as the repository's own `prettier` package, gitignored so that `nmr-fmt` does not select it
 * for formatting. Its CLI appends each invocation's arguments as one JSON line to the tree's record, and its
 * `resolveConfigFile` finds a `.prettierrc` beside the searched path alone.
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
  tree.write(
    path.join('node_modules/prettier', STUB_ENTRY),
    [
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(tree.resolve(RECORD_ENTRY))}, JSON.stringify(process.argv.slice(2)) + ${JSON.stringify('\n')});`,
      '',
    ].join('\n'),
  );
}

/** Returns the names of the files in the cache directory, or none when the directory does not exist. */
function listCacheFiles(tree: TempTree): string[] {
  return tree.exists(FMT_CACHE_DIRECTORY) ? tree.list(FMT_CACHE_DIRECTORY) : [];
}

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
 * Creates the standard fixture repository plus a tracked lockfile and an untracked, unignored `node_modules/`,
 * the state in which nmr-fmt uses the cache.
 */
function scaffoldCachedRepository(): TempTree {
  const tree = scaffoldRepository({ ...TRACKED_FILES, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" });
  tree.mkdir('node_modules');

  return tree;
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

/** Tracks a badly formatted file whose name starts with `-`. */
function trackDashLeadingFile(tree: TempTree): void {
  tree.write(DASH_LEADING_FILE, 'const  badly   =  1\n');
  runGitOrThrow(['add', '--all'], tree.dir);
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

// endregion | Helpers
