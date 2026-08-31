import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type CheckCacheEntry,
  computeCacheKey,
  computeRetentionKey,
  DEFAULT_CACHEABLE_COMMANDS,
  findStaleBuildOutput,
  formatMisplacedNoCacheWarning,
  readBuildOutputState,
  readCheckCacheEntry,
  readTranscript,
  recordTranscript,
  removeCheckCache,
  resolveCacheableCommands,
  resolveRunId,
  RUN_ID_ENV_VAR,
  type TreeSnapshot,
  writeCheckCacheEntry,
  writeDebugNote,
} from '../check-cache.ts';
import { resolveBuildCachePath } from '../commands/build-output.ts';
import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

const SNAPSHOT: TreeSnapshot = { hash: 'tree-hash', headSha: 'head-sha' };

describe('check-cache', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({ 'node_modules/': '' }, { prefix: 'nmr-check-cache-' }));
  });

  describe(resolveCacheableCommands, () => {
    it('caches the pure checks and the gate that composes them', () => {
      const commands = resolveCacheableCommands(undefined);

      expect([...commands].toSorted()).toStrictEqual(DEFAULT_CACHEABLE_COMMANDS.toSorted());
      expect(commands).toContain('ci');
      expect(commands).toContain('check:strict');
      expect(commands).toContain('root:typecheck');
    });

    it('leaves out the commands whose result does not follow from the tree', () => {
      // `audit` consults a vulnerability database that moves on its own; the mutating and build commands
      // either change the tree they were asked about or carry a cache of their own.
      const commands = resolveCacheableCommands(undefined);

      for (const command of ['audit', 'build', 'compile', 'fix', 'fmt', 'lint', 'prepush', 'test:all', 'upgrade']) {
        expect(commands).not.toContain(command);
      }
    });

    it('extends the defaults rather than replacing them', () => {
      const commands = resolveCacheableCommands({ extraCommands: ['verify'] });

      expect(commands).toContain('verify');
      expect(commands).toContain('ci');
    });

    it('drops an excluded default', () => {
      expect(resolveCacheableCommands({ excludeCommands: ['test:coverage'] })).not.toContain('test:coverage');
    });

    it('applies exclusions after additions, so a name in both is excluded', () => {
      const commands = resolveCacheableCommands({ extraCommands: ['verify'], excludeCommands: ['verify'] });

      expect(commands).not.toContain('verify');
    });
  });

  describe(computeCacheKey, () => {
    beforeEach(() => {
      writeInstallFingerprint(tree);
    });

    it('agrees with itself on unchanged inputs', () => {
      expect(keyOf(tree.dir)).toBe(keyOf(tree.dir));
    });

    it.each([
      ['the tree', { snapshot: { hash: 'other-tree', headSha: 'head-sha' } }],
      ['the command string', { commandString: 'nmr typecheck && nmr test' }],
      ['the command name', { command: 'check' }],
      ['nmr’s own version', { nmrVersion: '99.0.0' }],
      ['the Node version', { runtime: { arch: 'x64', nodeVersion: 'v99.0.0', platform: 'linux' } }],
      ['the platform', { runtime: { arch: 'x64', nodeVersion: 'v24.0.0', platform: 'win32' } }],
      ['the architecture', { runtime: { arch: 'arm64', nodeVersion: 'v24.0.0', platform: 'linux' } }],
      ['TZ', { env: { TZ: 'Pacific/Auckland' } }],
      ['LANG', { env: { LANG: 'fr_FR.UTF-8' } }],
      ['LC_ALL', { env: { LC_ALL: 'C' } }],
      ['NODE_OPTIONS', { env: { NODE_OPTIONS: '--max-old-space-size=8192' } }],
    ])('moves when %s changes', (_label, overrides) => {
      expect(keyOf(tree.dir, overrides)).not.toBe(keyOf(tree.dir));
    });

    it('moves when the scope changes', () => {
      // One tree can pass `check` at the root and fail it in a package; the two are different questions.
      expect(keyOf(tree.dir, { anchorDir: tree.resolve('packages/a') })).not.toBe(keyOf(tree.dir));
    });

    it('moves when what is installed changes', () => {
      const before = keyOf(tree.dir);

      tree.write('node_modules/.modules.yaml', 'hoistPattern:\n  - "*"\n');

      expect(keyOf(tree.dir)).not.toBe(before);
    });

    it('separates an unset environment variable from one set to the empty string', () => {
      expect(keyOf(tree.dir, { env: { TZ: '' } })).not.toBe(keyOf(tree.dir, { env: {} }));
    });

    it('ignores an environment variable outside the fixed set', () => {
      // The set stays fixed so that two machines differing only in shell decoration agree on the key.
      expect(keyOf(tree.dir, { env: { EDITOR: 'vim' } })).toBe(keyOf(tree.dir));
    });

    // Loudness changes what a run prints and never what it concludes, so a quiet run hits a pass a loud one
    // recorded. Folding it in would split every recorded pass across the two modes, and silently.
    it('ignores the verbosity a run was asked for', () => {
      expect(keyOf(tree.dir, { env: { [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' } })).toBe(
        keyOf(tree.dir, { env: { [COMMAND_VERBOSITY_ENV_VAR]: 'full' } }),
      );
    });

    // The format nmr reports its own verdicts in reaches no command, so it cannot change what one concludes.
    it('ignores the format a run reports in', () => {
      expect(keyOf(tree.dir, { env: { [REPORT_FORMAT_ENV_VAR]: 'json' } })).toBe(
        keyOf(tree.dir, { env: { [REPORT_FORMAT_ENV_VAR]: 'text' } }),
      );
    });

    it('refuses a key when the install fingerprint is unreadable', () => {
      tree.rm('node_modules/.pnpm');

      expect(computeCacheKey(keyOptions(tree.dir))).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('install fingerprint'),
      });
    });
  });

  describe(computeRetentionKey, () => {
    it('agrees with itself on unchanged inputs', () => {
      expect(retentionKeyOf()).toBe(retentionKeyOf());
    });

    it.each([
      ['CI', { env: { CI: '1' } }],
      ['COLUMNS', { env: { COLUMNS: '80' } }],
      ['FORCE_COLOR', { env: { FORCE_COLOR: '3' } }],
      ['NO_COLOR', { env: { NO_COLOR: '1' } }],
      ['TERM', { env: { TERM: 'dumb' } }],
    ])('moves when %s changes', (_label, overrides) => {
      expect(retentionKeyOf(overrides)).not.toBe(retentionKeyOf());
    });

    it.each([
      ['stdout', { channels: { stderr: 'pipe', stdout: 1 } }],
      ['stderr', { channels: { stderr: 2, stdout: 'pipe' } }],
    ] as const)('moves when the channel %s ran on changes', (_label, overrides) => {
      expect(retentionKeyOf(overrides)).not.toBe(retentionKeyOf());
    });

    // The number names which terminal a command wrote to, not whether what it wrote was a transcript.
    it('ignores which descriptor a stream ran on', () => {
      expect(retentionKeyOf({ channels: { stderr: 2, stdout: 1 } })).toBe(
        retentionKeyOf({ channels: { stderr: 9, stdout: 8 } }),
      );
    });

    // A machine-readable run is quiet, so it leaves a command on the channels a quiet run does and replays
    // what one recorded. Folding the format in would split every retained excerpt across the two.
    it('ignores the format a run reports in', () => {
      expect(retentionKeyOf({ env: { [REPORT_FORMAT_ENV_VAR]: 'json' } })).toBe(
        retentionKeyOf({ env: { [REPORT_FORMAT_ENV_VAR]: 'text' } }),
      );
    });

    it('moves when the pass it certifies moves', () => {
      expect(retentionKeyOf({ passKey: 'another-pass' })).not.toBe(retentionKeyOf());
    });

    it('separates an unset environment variable from one set to the empty string', () => {
      expect(retentionKeyOf({ env: { TERM: '' } })).not.toBe(retentionKeyOf({ env: {} }));
    });

    it('ignores an environment variable outside the fixed set', () => {
      expect(retentionKeyOf({ env: { EDITOR: 'vim' } })).toBe(retentionKeyOf());
    });

    describe('against the pass key', () => {
      beforeEach(() => {
        writeInstallFingerprint(tree);
      });

      it('given a presentation variable, moves while the pass key stands', () => {
        const passKey = keyOf(tree.dir, { env: { COLUMNS: '80' } });

        expect(passKey).toBe(keyOf(tree.dir));
        expect(retentionKeyOf({ env: { COLUMNS: '80' }, passKey })).not.toBe(retentionKeyOf({ passKey }));
      });

      it('given a channel kind, moves while the pass key stands', () => {
        expect(retentionKeyOf({ channels: { stderr: 2, stdout: 1 }, passKey: keyOf(tree.dir) })).not.toBe(
          retentionKeyOf({ passKey: keyOf(tree.dir) }),
        );
      });
    });
  });

  describe(resolveRunId, () => {
    it('keeps the identity an ancestor passed down, so one run has one identity at every scope', () => {
      expect(resolveRunId({ [RUN_ID_ENV_VAR]: 'the-run' })).toBe('the-run');
    });

    it('starts a run when the environment carries none', () => {
      expect(resolveRunId({})).not.toBe(resolveRunId({}));
    });

    it('starts a run when the inherited value is empty', () => {
      expect(resolveRunId({ [RUN_ID_ENV_VAR]: '' })).not.toBe('');
    });
  });

  describe('recorded entries', () => {
    it('reads back what it recorded', async () => {
      const entry = makeEntry();
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci', entry });

      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' }),
      ).resolves.toStrictEqual(entry);
    });

    it('reports no entry for a command that never recorded one', async () => {
      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'typecheck' }),
      ).resolves.toBeUndefined();
    });

    it('keeps one command’s entry separate from another’s', async () => {
      await writeCheckCacheEntry({
        monorepoRoot: tree.dir,
        anchorDir: tree.dir,
        command: 'ci',
        entry: makeEntry({ key: 'ci-key' }),
      });
      await writeCheckCacheEntry({
        monorepoRoot: tree.dir,
        anchorDir: tree.dir,
        command: 'typecheck',
        entry: makeEntry({ key: 'typecheck-key' }),
      });

      const entry = await readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' });
      expect(entry?.key).toBe('ci-key');
    });

    it('keeps one scope’s entry separate from another’s', async () => {
      const packageDir = tree.resolve('packages/a');
      await writeCheckCacheEntry({
        monorepoRoot: tree.dir,
        anchorDir: tree.dir,
        command: 'check',
        entry: makeEntry({ key: 'root-key' }),
      });
      await writeCheckCacheEntry({
        monorepoRoot: tree.dir,
        anchorDir: packageDir,
        command: 'check',
        entry: makeEntry({ key: 'package-key' }),
      });

      const entry = await readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: packageDir, command: 'check' });
      expect(entry?.key).toBe('package-key');
    });

    it('reads back the retention recorded beside a pass', async () => {
      const entry = makeEntry({
        retention: {
          key: 'a-retention-key',
          replay: [{ command: 'test', excerpt: '27 passed', scope: 'nmr' }],
          runId: 'a-run',
        },
      });
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'test', entry });

      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'test' }),
      ).resolves.toStrictEqual(entry);
    });

    it('reads an entry recorded before retention existed as a pass carrying nothing to replay', async () => {
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci', entry: makeEntry() });

      const entry = await readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' });

      expect(entry?.key).toBe('a-key');
      expect(entry?.retention).toBeUndefined();
    });

    it.each([
      ['retention with no key', { replay: [], runId: 'a-run' }],
      ['retention with no witness', { key: 'a-retention-key', replay: [] }],
      ['a replay that is not a list', { key: 'a-retention-key', replay: 'summary', runId: 'a-run' }],
      [
        'a replay line missing its excerpt',
        { key: 'a-retention-key', replay: [{ command: 'test', scope: 'nmr' }], runId: 'a-run' },
      ],
    ])('reads an entry claiming %s as a pass carrying nothing to replay', async (_label, retention) => {
      // What a skip would have replayed cannot decide whether the pass beneath it stands.
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci', entry: makeEntry() });
      overwriteEntries(tree, JSON.stringify({ ...makeEntry(), retention }));

      const entry = await readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' });

      expect(entry?.key).toBe('a-key');
      expect(entry?.retention).toBeUndefined();
    });

    it('reads an entry of the wrong shape as no entry', async () => {
      // An entry written by an older format is not a pass anyone can act on.
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci', entry: makeEntry() });
      overwriteEntries(tree, JSON.stringify({ treeHash: 'tree-hash' }));

      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' }),
      ).resolves.toBeUndefined();
    });

    it('clears every scope’s entries at once', async () => {
      // One removal is the whole table, so distrusting the cache never means hunting through packages.
      const packageDir = tree.resolve('packages/a');
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci', entry: makeEntry() });
      await writeCheckCacheEntry({
        monorepoRoot: tree.dir,
        anchorDir: packageDir,
        command: 'check',
        entry: makeEntry(),
      });

      await removeCheckCache(tree.dir);

      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' }),
      ).resolves.toBeUndefined();
      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: packageDir, command: 'check' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('a recorded transcript', () => {
    const REF = { anchorDir: '', command: 'test', monorepoRoot: '' };

    /** The ref for this test's temporary root, which `beforeEach` creates afresh. */
    function refFor(command: string, anchorDir?: string) {
      return { ...REF, anchorDir: anchorDir ?? tree.dir, command, monorepoRoot: tree.dir };
    }

    it('reads back what it recorded', async () => {
      await recordTranscript(refFor('test'), 'Test Files  6 passed (6)\n');

      await expect(readTranscript(refFor('test'))).resolves.toBe('Test Files  6 passed (6)\n');
    });

    it('reports none for a command that recorded none', async () => {
      await expect(readTranscript(refFor('typecheck'))).resolves.toBeUndefined();
    });

    it('keeps one command’s transcript separate from another’s', async () => {
      await recordTranscript(refFor('test'), 'test output');
      await recordTranscript(refFor('typecheck'), 'typecheck output');

      await expect(readTranscript(refFor('test'))).resolves.toBe('test output');
    });

    it('keeps one scope’s transcript separate from another’s', async () => {
      const packageDir = tree.resolve('packages/a');
      await recordTranscript(refFor('test'), 'root output');
      await recordTranscript(refFor('test', packageDir), 'package output');

      await expect(readTranscript(refFor('test', packageDir))).resolves.toBe('package output');
    });

    // A composite retains nothing of its own, so a leaf's transcript left standing beside its entry would be
    // dated by a run that never produced it.
    it('withdraws what an earlier pass left when this pass retained nothing', async () => {
      await recordTranscript(refFor('test'), 'an earlier run');

      await recordTranscript(refFor('test'), undefined);

      await expect(readTranscript(refFor('test'))).resolves.toBeUndefined();
    });

    it('leaves the entry beside it alone', async () => {
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'test', entry: makeEntry() });

      await recordTranscript(refFor('test'), undefined);

      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'test' }),
      ).resolves.toBeDefined();
    });

    it('is cleared with the passes it belongs to', async () => {
      await recordTranscript(refFor('test'), 'test output');

      await removeCheckCache(tree.dir);

      await expect(readTranscript(refFor('test'))).resolves.toBeUndefined();
    });
  });

  describe(readBuildOutputState, () => {
    it('reports a digest for every package nmr’s build covers', async () => {
      const { a, b } = scaffoldWorkspace(tree);
      writeBuildDigest(tree, a, 'digest-a');
      writeBuildDigest(tree, b, 'digest-b');

      await expect(readBuildOutputState(tree.dir, {})).resolves.toStrictEqual({
        missing: [],
        digests: { 'packages/a': 'digest-a', 'packages/b': 'digest-b' },
      });
    });

    it('keeps two packages of the same directory name apart', async () => {
      // A workspace glob set yielding `apps/web` beside `packages/web` would collapse onto one key if the
      // basename identified a package, and the shadowed one's output would never be compared again.
      scaffoldCollidingWorkspace(tree);

      await expect(readBuildOutputState(tree.dir, {})).resolves.toStrictEqual({
        missing: [],
        digests: { 'apps/web': 'digest-app', 'packages/web': 'digest-package' },
      });
    });

    it('names the package whose output went missing', async () => {
      // Build output is git-ignored, so the tree hash says nothing about it: without this a cached `ci`
      // would hand back a green exit over a repository that cannot run.
      const { a } = scaffoldWorkspace(tree);
      tree.rm(`${a}/dist`);

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missing: ['packages/a'] });
    });

    it('leaves out a package that overrides build in its package.json', async () => {
      // An override emits somewhere this does not know about, so demanding a `dist` would make the package a
      // permanent miss rather than a covered one.
      const { a } = scaffoldWorkspace(tree);
      tree.rm(`${a}/dist`);
      writePackageJson(tree, a, { build: 'tsup' });

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missing: [] });
    });

    it('leaves out a package that overrides compile in its package.json', async () => {
      const { a } = scaffoldWorkspace(tree);
      tree.rm(`${a}/dist`);
      writePackageJson(tree, a, { compile: 'tsc' });

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missing: [] });
    });

    it('leaves out every package when the repo redefines build in its config', async () => {
      const { a } = scaffoldWorkspace(tree);
      tree.rm(`${a}/dist`);

      await expect(readBuildOutputState(tree.dir, { workspaceScripts: { build: 'make' } })).resolves.toStrictEqual({
        missing: [],
        digests: {},
      });
    });

    it('expects no output from a package whose sources emit none', async () => {
      const { a } = scaffoldWorkspace(tree);
      tree.rm(`${a}/dist`);
      tree.rm(`${a}/src`);

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missing: [] });
    });

    it('expects no output from a package whose own config ignores every entry point', async () => {
      // The build compiles the entry set the package's own options leave; reading a different set here would
      // demand output the build never emits, and one such package takes the whole repo's gate down.
      const { a } = scaffoldWorkspace(tree);
      tree.rm(`${a}/dist`);
      writeWorkspaceConfig(tree, a, { build: { extraIgnorePatterns: ['**/*.ts'] } });

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missing: [] });
    });
  });

  describe(findStaleBuildOutput, () => {
    it('finds nothing when both observations found the same output', () => {
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one', b: 'two' })).toBeUndefined();
    });

    it('names a package whose output was rebuilt from different sources', () => {
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one', b: 'other' })).toBe('b');
    });

    it('names a package that has appeared between the two observations', () => {
      expect(findStaleBuildOutput({ a: 'one' }, { a: 'one', b: 'two' })).toBe('b');
    });

    it('names a package that has disappeared between the two observations', () => {
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one' })).toBe('b');
    });
  });

  describe('what the gate says out loud', () => {
    it('names the flag’s intended position when it lands after the command', () => {
      expect(formatMisplacedNoCacheWarning('ci')).toContain('nmr --no-cache ci');
    });

    it('says nothing about a gate decision unless asked', () => {
      // A reason to run is not news; a line per invocation would bury the output of whatever did run.
      const stderr = new PassThrough();
      const chunks: Buffer[] = [];
      stderr.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      writeDebugNote('tree changed', {}, stderr);

      expect(Buffer.concat(chunks).toString('utf8')).toBe('');
    });

    it('explains a gate decision when NMR_DEBUG is set', () => {
      const stderr = new PassThrough();
      const chunks: Buffer[] = [];
      stderr.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      writeDebugNote('tree changed', { NMR_DEBUG: '1' }, stderr);

      expect(Buffer.concat(chunks).toString('utf8')).toContain('tree changed');
    });
  });
});

// region | Helpers

/** Returns the key for a set of inputs, failing the test if no key could be computed. */
function keyOf(root: string, overrides: Partial<Parameters<typeof computeCacheKey>[0]> = {}): string {
  const result = computeCacheKey({ ...keyOptions(root), ...overrides });
  if (!result.ok) {
    throw new Error(`expected a key, got: ${result.reason}`);
  }
  return result.key;
}

/** The baseline key inputs each test varies one ingredient of. */
function keyOptions(root: string): Parameters<typeof computeCacheKey>[0] {
  return {
    anchorDir: root,
    command: 'ci',
    commandString: 'nmr build && nmr check:strict',
    env: {},
    monorepoRoot: root,
    nmrVersion: '1.0.0',
    runtime: { arch: 'x64', nodeVersion: 'v24.0.0', platform: 'linux' },
    snapshot: SNAPSHOT,
  };
}

/** The baseline retention-key inputs each test varies one ingredient of. */
function retentionKeyOf(overrides: Partial<Parameters<typeof computeRetentionKey>[0]> = {}): string {
  return computeRetentionKey({
    channels: { stderr: 'pipe', stdout: 'pipe' },
    env: {},
    passKey: 'a-pass-key',
    ...overrides,
  });
}

/** Builds a valid entry, so a test varies only the field it is about. */
function makeEntry(overrides: Partial<CheckCacheEntry> = {}): CheckCacheEntry {
  return {
    key: 'a-key',
    treeHash: SNAPSHOT.hash,
    headSha: SNAPSHOT.headSha,
    commandString: 'nmr build && nmr check:strict',
    nmrVersion: '1.0.0',
    nodeVersion: 'v24.0.0',
    durationMs: 1_000,
    recordedAt: '2026-08-02T12:00:00.000Z',
    buildDigests: {},
    ...overrides,
  };
}

/** Replaces the content of every recorded entry, standing in for one written by an older format. */
function overwriteEntries(tree: TempTree, content: string): void {
  const cacheDir = 'node_modules/.cache/nmr-check';
  for (const entry of tree.list(cacheDir)) {
    tree.write(`${cacheDir}/${entry}`, content);
  }
}

/** Writes a workspace whose globs yield two packages sharing a directory name, each freshly built. */
function scaffoldCollidingWorkspace(tree: TempTree): void {
  tree.write('pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n  - "packages/*"\n');

  for (const [packagePath, digest] of [
    ['apps/web', 'digest-app'],
    ['packages/web', 'digest-package'],
  ] as const) {
    scaffoldBuiltPackage(tree, packagePath, packagePath.replace('/', '-'));
    writeBuildDigest(tree, packagePath, digest);
  }
}

/** Writes a pnpm workspace holding two packages that look freshly built, and returns their paths in the tree. */
function scaffoldWorkspace(tree: TempTree): { a: string; b: string } {
  tree.write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');

  const a = 'packages/a';
  const b = 'packages/b';
  for (const [packagePath, name] of [
    [a, 'a'],
    [b, 'b'],
  ] as const) {
    scaffoldBuiltPackage(tree, packagePath, name);
  }

  return { a, b };
}

/** Writes the sources and emitted output of a package a build has already covered. */
function scaffoldBuiltPackage(tree: TempTree, packagePath: string, name: string): void {
  tree.writeAll({
    [`${packagePath}/src/index.ts`]: 'export const value = 1;\n',
    [`${packagePath}/dist/esm/index.js`]: 'export const value = 1;\n',
  });
  writePackageJson(tree, packagePath, undefined, name);
}

/** Writes the digest a build of the package at `packagePath` would have left behind. */
function writeBuildDigest(tree: TempTree, packagePath: string, digest: string): void {
  tree.write(resolveBuildCachePath(tree.resolve(packagePath)), digest);
}

/** Writes a package's own nmr config. */
function writeWorkspaceConfig(tree: TempTree, packagePath: string, config: Record<string, unknown>): void {
  tree.write(`${packagePath}/.config/nmr.config.ts`, `export default ${JSON.stringify(config)};\n`);
}

/** Writes the pnpm files the install fingerprint reads. */
function writeInstallFingerprint(tree: TempTree): void {
  tree.writeAll({
    'node_modules/.modules.yaml': 'hoistPattern:\n  - "types"\n',
    'node_modules/.pnpm/lock.yaml': 'lockfileVersion: "9.0"\n',
  });
}

/** Writes a package manifest, optionally declaring scripts that override the built-in build. */
function writePackageJson(
  tree: TempTree,
  packagePath: string,
  scripts?: Record<string, string>,
  name = path.basename(packagePath),
): void {
  tree.writeJson(`${packagePath}/package.json`, { name, type: 'module', ...(scripts && { scripts }) });
}

// endregion | Helpers
