import { createHash } from 'node:crypto';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished, makeFixture, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import * as ts from 'typescript';
import { afterEach, assert, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { buildPackage } from '../build.ts';
import {
  readBuildDigest,
  readEmitDuration,
  resolveBuildCachePath,
  resolveEmitDurationPath,
  resolveScratchDirs,
  writeEmitDuration,
} from '../build-output.ts';
import { countBuilds, listEmitted, readOutput, scaffoldPackage } from '../test-utils/build-fixtures.ts';

// Default the compiler API to the real implementation so that the regression suite compiles for real;
// the cache-integrity tests override createProgram per-call to simulate a failing or transient compile.
vi.mock(import('typescript'), async (importOriginal) => {
  const actual = await importOriginal();
  // Attach the implementation after construction. Passing it to `vi.fn` would infer the overloaded signature of
  // `createProgram`, and `Mock<T>` collapses an overload set to its last member, which the module's shape rejects.
  const createProgram = vi.fn();
  createProgram.mockImplementation(actual.createProgram);
  return { ...actual, createProgram };
});

/**
 * One edit to a package's `.config/nmr.config.ts`, applied to the tree so that a case can create, rewrite, or
 * delete it.
 */
type ConfigStep = (tree: TempTree) => void;

/** The package config read by a build, which several cases create, rewrite, or delete between runs. */
const CONFIG_ENTRY = '.config/nmr.config.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-build-' })),
);

describe('buildPackage output-directory ownership', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('drops output whose source has been deleted', async ({ tree }) => {
    scaffoldPackage(tree, {
      'index.ts': 'export const value = 1;\n',
      'obsolete.ts': 'export const obsolete = 1;\n',
    });
    await buildPackage(tree.dir, { style: 'rich' });
    expect(listEmitted(tree)).toContain('obsolete.js');

    tree.rm('src/obsolete.ts');
    await buildPackage(tree.dir, { style: 'rich' });

    expect(listEmitted(tree)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('drops output whose source has since become ignored', async ({ tree }) => {
    // A rebuild that only wrote files would leave the helper emitted by the first build in place.
    scaffoldPackage(tree, {
      'index.ts': 'export const value = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });
    await buildPackage(tree.dir, { style: 'rich', ignorePatterns: [] });
    expect(listEmitted(tree)).toContain('test-utils/helper.js');

    await buildPackage(tree.dir, { style: 'rich' });

    expect(listEmitted(tree)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  // `for` rather than `each`: Only `for` hands the fixture context to the case body.
  it.for(['.', '../escape'])('refuses to build into %s and removes nothing', async (outdir, { tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    await expect(buildPackage(tree.dir, { style: 'rich', outdir })).rejects.toThrow(
      /does not resolve inside the package/,
    );

    expect(tree.exists('src/index.ts')).toBe(true);
  });

  it('builds a package lacking entry points without touching an absent output directory', async ({ tree }) => {
    scaffoldPackage(tree, { '__tests__/index.test.ts': 'export const covered = 1;\n' });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(tree.exists('dist')).toBe(false);
  });
});

describe('buildPackage atomic publication', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('leaves the previous output intact when the specifier rewrite fails', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    const publishedOutput = readOutput(tree, 'index.js');

    // An alias whose target does not exist survives the emit and fails in the rewrite pass, which is the furthest point
    // a build can fail: everything the publish needs has already been produced.
    tree.write('src/index.ts', `import { missing } from '~/nonexistent.ts';\nexport const value = missing;\n`);
    await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow(/could not resolve aliased import/);

    expect(readOutput(tree, 'index.js')).toBe(publishedOutput);
  });

  it('leaves the previous output intact when writing the staged output fails', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    const publishedOutput = readOutput(tree, 'index.js');

    tree.write('src/index.ts', 'export const value = 2;\n');
    const writeFile = vi.spyOn(ts.sys, 'writeFile').mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow('ENOSPC');
    writeFile.mockRestore();

    expect(readOutput(tree, 'index.js')).toBe(publishedOutput);
  });

  it('leaves the previous output intact when the emit reports itself skipped', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    const publishedOutput = readOutput(tree, 'index.js');

    tree.write('src/index.ts', 'export const value = 2;\n');
    const compile = vi.mocked(ts.createProgram).getMockImplementation();
    assert(compile !== undefined);
    // A skipped emit is the emit-path failure that occurs after the program is complete.
    vi.mocked(ts.createProgram).mockImplementationOnce((...args) => ({
      ...compile(...args),
      emit: () => ({ diagnostics: [], emitSkipped: true }),
    }));
    await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow(/emit failed/);

    expect(readOutput(tree, 'index.js')).toBe(publishedOutput);
  });

  it('leaves the previous output intact when the declarations emit reports itself skipped', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    const publishedOutput = readOutput(tree, 'index.js');

    tree.write('src/index.ts', 'export const value = 2;\n');
    const compile = vi.mocked(ts.createProgram).getMockImplementation();
    assert(compile !== undefined);
    // The scripts program emits successfully, so the failure occurs when the buffer is full and nothing is published.
    vi.mocked(ts.createProgram)
      .mockImplementationOnce(compile)
      .mockImplementationOnce((...args) => ({
        ...compile(...args),
        emit: () => ({ diagnostics: [], emitSkipped: true }),
      }));
    await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow(/emit failed/);

    expect(readOutput(tree, 'index.js')).toBe(publishedOutput);
  });

  it('clears a scratch directory on a build that skips', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });

    tree.mkdir(resolveStagingEntry(tree));

    // Inputs are unchanged, so this run never reaches the emit -- the one path without another sweeper.
    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('⏩'));
    expect(listScratch(tree)).toStrictEqual([]);
  });

  it('clears a scratch directory left behind by a killed run', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });

    tree.write(`${resolveStagingEntry(tree)}/orphan.js`, 'export const orphan = 1;\n');

    tree.write('src/index.ts', 'export const value = 2;\n');
    await buildPackage(tree.dir, { style: 'rich' });

    // The orphan is gone rather than published: A fixed scratch name is cleared before use, so nothing
    // accumulates and a sweep does not have to tell an orphan from a directory that another build is
    // still writing.
    expect(listScratch(tree)).toStrictEqual([]);
    expect(listEmitted(tree)).toStrictEqual(['index.d.ts', 'index.js']);
  });
});

describe('buildPackage caching', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    // Clear call history but keep the real default implementation for the next test.
    vi.mocked(ts.createProgram).mockClear();
  });

  it('compiles src to dist/esm', async ({ tree }) => {
    scaffoldPackage(tree, {
      'index.ts': `export { helper } from './helper.ts';\n`,
      'helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(readOutput(tree, 'index.js')).toContain('./helper.js');
  });

  it('writes a cache file and skips an unchanged rebuild', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    expect(tree.exists(resolveCacheEntry(tree))).toBe(true);

    // Only the second (unchanged) build logs "No changes detected"; the first logs "Changes detected".
    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
  });

  it('produces the same digest on an unchanged rebuild, which skips', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    const firstDigest = await readBuildDigest(tree.dir);

    await buildPackage(tree.dir, { style: 'rich' });

    expect(firstDigest).toBeDefined();
    await expect(readBuildDigest(tree.dir)).resolves.toBe(firstDigest);
    expect(countBuilds()).toBe(1);
  });

  it('records the emit duration under the digest of the build that it timed', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(tree.dir, { style: 'rich' });

    const digest = await readBuildDigest(tree.dir);
    assert(digest !== undefined);
    await expect(readEmitDuration(tree.dir, digest)).resolves.toBeGreaterThanOrEqual(0);
  });

  it('names the saving on a skip whose recorded emit took at least a second', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    const digest = await readBuildDigest(tree.dir);
    assert(digest !== undefined);
    // A real emit of one file takes well under the threshold, so plant a slower one.
    await writeEmitDuration(tree.dir, digest, 2_100);

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(
      expect.stringMatching(/No changes detected\. Skipping build, saved ~2\.1s\.$/),
    );
  });

  it.for([
    ['recorded under another digest', async (tree: TempTree) => writeEmitDuration(tree.dir, 'an-old-digest', 2_100)],
    [
      'under a second',
      async (tree: TempTree) => writeEmitDuration(tree.dir, (await readBuildDigest(tree.dir)) ?? '', 900),
    ],
    ['missing', (tree: TempTree) => tree.rm(path.relative(tree.dir, resolveEmitDurationPath(tree.dir)))],
  ] as const)('omits the saving when the recorded duration is %s', async ([, plantDuration], { tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    await plantDuration(tree);

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/No changes detected\. Skipping build\.$/));
  });

  // Each row expresses the config edits as steps, so the parameterized body applies them without branching on
  // whether a config is present before or after.
  const leaveAbsent: ConfigStep = () => {};
  const writeEmptyConfig: ConfigStep = (tree) => tree.write(CONFIG_ENTRY, `export default { build: {} };\n`);
  const writeIgnorePatterns: ConfigStep = (tree) =>
    tree.write(CONFIG_ENTRY, `export default { build: { extraIgnorePatterns: ['**/a/**'] } };\n`);
  const removeConfig: ConfigStep = (tree) => tree.rm(CONFIG_ENTRY);

  // `for` rather than `each`: Only `for` hands the fixture context to the case body, and it passes the case
  // as one argument rather than spreading it.
  it.for([
    ['creating', leaveAbsent, writeIgnorePatterns],
    ['editing', writeEmptyConfig, writeIgnorePatterns],
    ['deleting', writeIgnorePatterns, removeConfig],
  ] as const)('rebuilds after %s the package config', async ([, setUpConfig, changeConfig], { tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    setUpConfig(tree);
    await buildPackage(tree.dir, { style: 'rich' });
    vi.mocked(console.info).mockClear();

    changeConfig(tree);
    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Changes detected'));
  });

  it('writes the cache under node_modules/.cache/nmr-compile, never inside dist', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(resolveBuildCachePath(tree.dir)).toContain(path.join('node_modules', '.cache', 'nmr-compile'));
    expect(tree.exists(resolveCacheEntry(tree))).toBe(true);
    expect(tree.exists('dist/esm/.cache')).toBe(false);
  });

  it('rebuilds when the output directory has been deleted', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });

    // The cache lives outside `dist`, so wiping the output leaves the digest intact. Skipping here would
    // leave an empty `dist`, and pack an empty tarball, without error.
    tree.rm('dist');

    await buildPackage(tree.dir, { style: 'rich' });

    expect(countBuilds()).toBe(2);
    expect(tree.exists('dist/esm/index.js')).toBe(true);
  });

  it('rebuilds when the output directory survives but has been emptied', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });

    for (const entry of tree.list('dist/esm')) {
      tree.rm(`dist/esm/${entry}`);
    }

    await buildPackage(tree.dir, { style: 'rich' });

    expect(countBuilds()).toBe(2);
    expect(tree.exists('dist/esm/index.js')).toBe(true);
  });

  it('reports missing output rather than changed inputs when the output is gone', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    tree.rm('dist');

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Build output is missing'));
  });

  it('skips a package whose sources are all declaration files instead of reporting missing output', async ({
    tree,
  }) => {
    // A `.d.ts` file matches the entry glob but emits nothing, so the build never creates an outdir.
    scaffoldPackage(tree, { 'ambient.d.ts': 'export declare const value: number;\n' });
    await buildPackage(tree.dir, { style: 'rich' });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Build output is missing'));
  });

  it('skips a package whose sources are all ignored instead of reporting missing output', async ({ tree }) => {
    // Only a test file, which the default ignore excludes: The package does not have any entry
    // points, so it emits nothing and its outdir never exists. That absence is not deleted output,
    // and must not be mistaken for it on every subsequent run.
    scaffoldPackage(tree, { '__tests__/index.test.ts': 'export const covered = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Build output is missing'));
  });

  it('reports the package directory name and the package icon when changes are detected', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('📦'));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining(path.basename(tree.dir)));
  });

  it('does not write the build cache when the compile fails', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('compile failed');
    });

    await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow('compile failed');

    expect(tree.exists(resolveCacheEntry(tree))).toBe(false);
  });

  it('re-attempts and rebuilds after a transient compile failure instead of skipping', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('transient failure');
    });
    await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow('transient failure');

    // Sources are unchanged: A cache poisoned by the failed run would make this skip the compile.
    // Instead it must re-attempt, and with the transient failure gone, produce output and cache it.
    await buildPackage(tree.dir, { style: 'rich' });

    expect(countBuilds()).toBe(2);
    expect(tree.exists('dist/esm/index.js')).toBe(true);
    expect(tree.exists(resolveCacheEntry(tree))).toBe(true);
  });

  it('preserves an existing cache when a changed-source rebuild fails', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    const lastGoodDigest = tree.read(resolveCacheEntry(tree));

    // A changed source forces the rebuild to be attempted rather than skipped; make that rebuild fail.
    tree.write('src/index.ts', 'export const value = 2;\n');
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('rebuild failed');
    });
    await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow('rebuild failed');

    expect(tree.read(resolveCacheEntry(tree))).toBe(lastGoodDigest);

    // With the failure gone, the next run rebuilds the changed source and refreshes the cache.
    await buildPackage(tree.dir, { style: 'rich' });
    expect(readOutput(tree, 'index.js')).toContain('value = 2');
    expect(tree.read(resolveCacheEntry(tree))).not.toBe(lastGoodDigest);
  });
});

describe('buildPackage closing statement', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('closes the build with the count of files it published', async ({ tree }) => {
    // Two sources, each emitting a `.js` and a `.d.ts`.
    scaffoldPackage(tree, {
      'index.ts': `export { helper } from './helper.ts';\n`,
      'helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Compiled 4 files to dist/esm.'));
  });

  it('names the resolved outdir rather than the default', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(tree.dir, { style: 'rich', outdir: 'build' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Compiled 2 files to build.'));
  });

  it('closes a package whose entry points emit nothing, which said nothing before', async ({ tree }) => {
    // A `src` tree of declaration files alone is an entry point for which the compiler does not emit any output.
    scaffoldPackage(tree, { 'types.d.ts': 'export type Value = number;\n' });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Did not emit any output.'));
  });

  it('leaves the skip path to its own conclusion', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir, { style: 'rich' });
    vi.mocked(console.info).mockClear();

    await buildPackage(tree.dir, { style: 'rich' });

    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Compiled'));
  });
});

describe(resolveBuildCachePath, () => {
  it("places the cache in the package's own node_modules when it has one", ({ tree }) => {
    tree.mkdir('pkg/node_modules');
    const packageDir = tree.resolve('pkg');

    expect(path.dirname(resolveBuildCachePath(packageDir))).toBe(
      path.join(packageDir, 'node_modules', '.cache', 'nmr-compile'),
    );
  });

  it('falls back to the nearest ancestor node_modules for a package that has none', ({ tree }) => {
    // Mirrors a zero-dependency workspace leaf: Because the leaf does not have a
    // node_modules of its own, the cache must resolve to a hoisted ancestor rather than
    // a stray directory beside dist.
    tree.mkdir('node_modules');
    const packageDir = tree.mkdir('packages/leaf');

    expect(path.dirname(resolveBuildCachePath(packageDir))).toBe(
      path.join(tree.dir, 'node_modules', '.cache', 'nmr-compile'),
    );
  });

  it('derives a stable, package-specific key', ({ tree }) => {
    tree.writeAll({ 'a/node_modules/': '', 'b/node_modules/': '' });
    const aDir = tree.resolve('a');
    const bDir = tree.resolve('b');

    expect(resolveBuildCachePath(aDir)).toBe(resolveBuildCachePath(aDir));
    expect(resolveBuildCachePath(aDir)).not.toBe(resolveBuildCachePath(bDir));
  });

  it('resolves to the path under which entries already on disk were written', ({ tree }) => {
    tree.mkdir('pkg/node_modules');
    const packageDir = tree.resolve('pkg');
    // Spelled out rather than derived from the store, so that a change to how the store keys an entry fails
    // here instead of silently orphaning every digest written by a previous build, which forces a spurious
    // full rebuild.
    const digest = createHash('sha256').update(packageDir).digest('hex').slice(0, 8);

    expect(resolveBuildCachePath(packageDir)).toBe(
      path.join(packageDir, 'node_modules', '.cache', 'nmr-compile', `pkg-${digest}.hash`),
    );
  });
});

// region | Helpers

/** Returns the names of the scratch directories that still exist beside the package's emit directory. */
function listScratch(tree: TempTree): string[] {
  // Listed rather than reached through `Object.values`, whose fixed-key overload yields `any[]`.
  const { previousDir, stagingDir } = resolveScratchDirs(tree.resolve('dist/esm'));

  return [previousDir, stagingDir]
    .map((scratchDir) => path.relative(tree.dir, scratchDir))
    .filter((scratchDir) => tree.exists(scratchDir))
    .map((scratchDir) => path.basename(scratchDir));
}

/** Resolves the package's build-cache entry, relative to the tree: The store returns the absolute path that it keys. */
function resolveCacheEntry(tree: TempTree): string {
  return path.relative(tree.dir, resolveBuildCachePath(tree.dir));
}

/** Resolves the scratch directory into which a build stages:`resolveScratchDirs` reports it as an absolute path. */
function resolveStagingEntry(tree: TempTree): string {
  return path.relative(tree.dir, resolveScratchDirs(tree.resolve('dist/esm')).stagingDir);
}

// endregion | Helpers
