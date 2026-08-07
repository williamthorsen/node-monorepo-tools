import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CheckCacheEntry, TreeSnapshot } from '../check-cache.ts';
import {
  computeCacheKey,
  DEFAULT_CACHEABLE_COMMANDS,
  findStaleBuildOutput,
  formatMisplacedNoCacheWarning,
  formatSkipLine,
  readBuildOutputState,
  readCheckCacheEntry,
  removeCheckCache,
  resolveCacheableCommands,
  writeCheckCacheEntry,
  writeDebugNote,
} from '../check-cache.ts';
import { resolveBuildCachePath } from '../commands/build-output.ts';

const SNAPSHOT: TreeSnapshot = { hash: 'tree-hash', headSha: 'head-sha' };

describe('check-cache', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-check-cache-')));
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
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
      writeInstallFingerprint(root);
    });

    it('agrees with itself on unchanged inputs', () => {
      expect(keyOf(root)).toBe(keyOf(root));
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
      expect(keyOf(root, overrides)).not.toBe(keyOf(root));
    });

    it('moves when the scope changes', () => {
      // One tree can pass `check` at the root and fail it in a package; the two are different questions.
      expect(keyOf(root, { anchorDir: path.join(root, 'packages', 'a') })).not.toBe(keyOf(root));
    });

    it('moves when what is installed changes', () => {
      const before = keyOf(root);

      fs.writeFileSync(path.join(root, 'node_modules', '.modules.yaml'), 'hoistPattern:\n  - "*"\n');

      expect(keyOf(root)).not.toBe(before);
    });

    it('separates an unset environment variable from one set to the empty string', () => {
      expect(keyOf(root, { env: { TZ: '' } })).not.toBe(keyOf(root, { env: {} }));
    });

    it('ignores an environment variable outside the fixed set', () => {
      // The set stays fixed so that two machines differing only in shell decoration agree on the key.
      expect(keyOf(root, { env: { EDITOR: 'vim' } })).toBe(keyOf(root));
    });

    it('refuses a key when the install fingerprint is unreadable', () => {
      fs.rmSync(path.join(root, 'node_modules', '.pnpm'), { recursive: true, force: true });

      expect(computeCacheKey(keyOptions(root))).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('install fingerprint'),
      });
    });
  });

  describe('recorded entries', () => {
    it('reads back what it recorded', async () => {
      const entry = makeEntry();
      await writeCheckCacheEntry({ monorepoRoot: root, anchorDir: root, command: 'ci', entry });

      await expect(readCheckCacheEntry({ monorepoRoot: root, anchorDir: root, command: 'ci' })).resolves.toStrictEqual(
        entry,
      );
    });

    it('reports no entry for a command that never recorded one', async () => {
      await expect(
        readCheckCacheEntry({ monorepoRoot: root, anchorDir: root, command: 'typecheck' }),
      ).resolves.toBeUndefined();
    });

    it('keeps one command’s entry separate from another’s', async () => {
      await writeCheckCacheEntry({
        monorepoRoot: root,
        anchorDir: root,
        command: 'ci',
        entry: makeEntry({ key: 'ci-key' }),
      });
      await writeCheckCacheEntry({
        monorepoRoot: root,
        anchorDir: root,
        command: 'typecheck',
        entry: makeEntry({ key: 'typecheck-key' }),
      });

      const entry = await readCheckCacheEntry({ monorepoRoot: root, anchorDir: root, command: 'ci' });
      expect(entry?.key).toBe('ci-key');
    });

    it('keeps one scope’s entry separate from another’s', async () => {
      const packageDir = path.join(root, 'packages', 'a');
      await writeCheckCacheEntry({
        monorepoRoot: root,
        anchorDir: root,
        command: 'check',
        entry: makeEntry({ key: 'root-key' }),
      });
      await writeCheckCacheEntry({
        monorepoRoot: root,
        anchorDir: packageDir,
        command: 'check',
        entry: makeEntry({ key: 'package-key' }),
      });

      const entry = await readCheckCacheEntry({ monorepoRoot: root, anchorDir: packageDir, command: 'check' });
      expect(entry?.key).toBe('package-key');
    });

    it('reads an entry of the wrong shape as no entry', async () => {
      // An entry written by an older format is not a pass anyone can act on.
      await writeCheckCacheEntry({ monorepoRoot: root, anchorDir: root, command: 'ci', entry: makeEntry() });
      overwriteEntries(root, JSON.stringify({ treeHash: 'tree-hash' }));

      await expect(
        readCheckCacheEntry({ monorepoRoot: root, anchorDir: root, command: 'ci' }),
      ).resolves.toBeUndefined();
    });

    it('clears every scope’s entries at once', async () => {
      // One removal is the whole table, so distrusting the cache never means hunting through packages.
      const packageDir = path.join(root, 'packages', 'a');
      await writeCheckCacheEntry({ monorepoRoot: root, anchorDir: root, command: 'ci', entry: makeEntry() });
      await writeCheckCacheEntry({ monorepoRoot: root, anchorDir: packageDir, command: 'check', entry: makeEntry() });

      await removeCheckCache(root);

      await expect(
        readCheckCacheEntry({ monorepoRoot: root, anchorDir: root, command: 'ci' }),
      ).resolves.toBeUndefined();
      await expect(
        readCheckCacheEntry({ monorepoRoot: root, anchorDir: packageDir, command: 'check' }),
      ).resolves.toBeUndefined();
    });
  });

  describe(readBuildOutputState, () => {
    it('reports a digest for every package nmr’s build covers', async () => {
      const { a, b } = scaffoldWorkspace(root);
      writeBuildDigest(a, 'digest-a');
      writeBuildDigest(b, 'digest-b');

      await expect(readBuildOutputState(root, {})).resolves.toStrictEqual({
        missing: [],
        digests: { 'packages/a': 'digest-a', 'packages/b': 'digest-b' },
      });
    });

    it('keeps two packages of the same directory name apart', async () => {
      // A workspace glob set yielding `apps/web` beside `packages/web` would collapse onto one key if the
      // basename identified a package, and the shadowed one's output would never be compared again.
      scaffoldCollidingWorkspace(root);

      await expect(readBuildOutputState(root, {})).resolves.toStrictEqual({
        missing: [],
        digests: { 'apps/web': 'digest-app', 'packages/web': 'digest-package' },
      });
    });

    it('names the package whose output went missing', async () => {
      // Build output is git-ignored, so the tree hash says nothing about it: without this a cached `ci`
      // would hand back a green exit over a repository that cannot run.
      const { a } = scaffoldWorkspace(root);
      fs.rmSync(path.join(a, 'dist'), { recursive: true, force: true });

      await expect(readBuildOutputState(root, {})).resolves.toMatchObject({ missing: ['packages/a'] });
    });

    it('leaves out a package that overrides build in its package.json', async () => {
      // An override emits somewhere this does not know about, so demanding a `dist` would make the package a
      // permanent miss rather than a covered one.
      const { a } = scaffoldWorkspace(root);
      fs.rmSync(path.join(a, 'dist'), { recursive: true, force: true });
      writePackageJson(a, { build: 'tsup' });

      await expect(readBuildOutputState(root, {})).resolves.toMatchObject({ missing: [] });
    });

    it('leaves out a package that overrides compile in its package.json', async () => {
      const { a } = scaffoldWorkspace(root);
      fs.rmSync(path.join(a, 'dist'), { recursive: true, force: true });
      writePackageJson(a, { compile: 'tsc' });

      await expect(readBuildOutputState(root, {})).resolves.toMatchObject({ missing: [] });
    });

    it('leaves out every package when the repo redefines build in its config', async () => {
      const { a } = scaffoldWorkspace(root);
      fs.rmSync(path.join(a, 'dist'), { recursive: true, force: true });

      await expect(readBuildOutputState(root, { workspaceScripts: { build: 'make' } })).resolves.toStrictEqual({
        missing: [],
        digests: {},
      });
    });

    it('expects no output from a package whose sources emit none', async () => {
      const { a } = scaffoldWorkspace(root);
      fs.rmSync(path.join(a, 'dist'), { recursive: true, force: true });
      fs.rmSync(path.join(a, 'src'), { recursive: true, force: true });

      await expect(readBuildOutputState(root, {})).resolves.toMatchObject({ missing: [] });
    });

    it('expects no output from a package whose own config ignores every entry point', async () => {
      // The build compiles the entry set the package's own options leave; reading a different set here would
      // demand output the build never emits, and one such package takes the whole repo's gate down.
      const { a } = scaffoldWorkspace(root);
      fs.rmSync(path.join(a, 'dist'), { recursive: true, force: true });
      writeWorkspaceConfig(a, { build: { extraIgnorePatterns: ['**/*.ts'] } });

      await expect(readBuildOutputState(root, {})).resolves.toMatchObject({ missing: [] });
    });
  });

  describe(findStaleBuildOutput, () => {
    it('finds nothing when every package still holds the output the pass was recorded over', () => {
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one', b: 'two' })).toBeUndefined();
    });

    it('names a package whose output was rebuilt from different sources', () => {
      // Restoring a tree restores none of its build output, so presence alone would let a `dist` compiled
      // from another tree pass for this one -- and the run that would have rebuilt it is the one being skipped.
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one', b: 'other' })).toBe('b');
    });

    it('names a package that has appeared since the pass was recorded', () => {
      expect(findStaleBuildOutput({ a: 'one' }, { a: 'one', b: 'two' })).toBe('b');
    });

    it('names a package that has disappeared since the pass was recorded', () => {
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one' })).toBe('b');
    });
  });

  describe('what the gate says out loud', () => {
    it('spends the recorded metadata on the skip line', () => {
      const recordedAt = new Date('2026-08-02T12:00:00Z');
      const entry = makeEntry({ recordedAt: recordedAt.toISOString(), durationMs: 240_000 });

      const line = formatSkipLine('ci', entry, recordedAt.getTime() + 720_000);

      expect(line).toBe('⏭️ ci: passed 12m ago on this tree (🚀 saved ~4m).');
    });

    it('drops the whole saving clause when the pass was too quick to have saved anything', () => {
      // An empty or zeroed parenthetical would spend the icon on nothing; the sentence has to read without it.
      const recordedAt = new Date('2026-08-02T12:00:00Z');
      const entry = makeEntry({ recordedAt: recordedAt.toISOString(), durationMs: 40 });

      const line = formatSkipLine('typecheck', entry, recordedAt.getTime() + 720_000);

      expect(line).toBe('⏭️ typecheck: passed 12m ago on this tree.');
    });

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
function overwriteEntries(root: string, content: string): void {
  const cacheDir = path.join(root, 'node_modules', '.cache', 'nmr-check');
  for (const entry of fs.readdirSync(cacheDir)) {
    fs.writeFileSync(path.join(cacheDir, entry), content);
  }
}

/** Writes a workspace whose globs yield two packages sharing a directory name, each freshly built. */
function scaffoldCollidingWorkspace(root: string): void {
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n');

  for (const [relativePath, digest] of [
    ['apps/web', 'digest-app'],
    ['packages/web', 'digest-package'],
  ] as const) {
    const dir = path.join(root, relativePath);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'dist', 'esm'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(dir, 'dist', 'esm', 'index.js'), 'export const value = 1;\n');
    writePackageJson(dir, undefined, relativePath.replace('/', '-'));
    writeBuildDigest(dir, digest);
  }
}

/** Writes a pnpm workspace holding two packages that look freshly built, and returns their directories. */
function scaffoldWorkspace(root: string): { a: string; b: string } {
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');

  const a = path.join(root, 'packages', 'a');
  const b = path.join(root, 'packages', 'b');
  for (const [dir, name] of [
    [a, 'a'],
    [b, 'b'],
  ] as const) {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'dist', 'esm'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(dir, 'dist', 'esm', 'index.js'), 'export const value = 1;\n');
    writePackageJson(dir, undefined, name);
  }

  return { a, b };
}

/** Writes the digest a build of `packageDir` would have left behind. */
function writeBuildDigest(packageDir: string, digest: string): void {
  const cachePath = resolveBuildCachePath(packageDir);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, digest);
}

/** Writes a package's own nmr config. */
function writeWorkspaceConfig(packageDir: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.join(packageDir, '.config'), { recursive: true });
  fs.writeFileSync(path.join(packageDir, '.config', 'nmr.config.ts'), `export default ${JSON.stringify(config)};\n`);
}

/** Writes the pnpm files the install fingerprint reads. */
function writeInstallFingerprint(root: string): void {
  fs.mkdirSync(path.join(root, 'node_modules', '.pnpm'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', '.modules.yaml'), 'hoistPattern:\n  - "types"\n');
  fs.writeFileSync(path.join(root, 'node_modules', '.pnpm', 'lock.yaml'), 'lockfileVersion: "9.0"\n');
}

/** Writes a package manifest, optionally declaring scripts that override the built-in build. */
function writePackageJson(dir: string, scripts?: Record<string, string>, name = path.basename(dir)): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, type: 'module', ...(scripts && { scripts }) }),
  );
}

// endregion | Helpers
