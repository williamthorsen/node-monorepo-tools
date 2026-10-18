import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEBUG_ENV_VAR, PASS_MANIFEST_DIR_ENV_VAR } from '../check-cache.ts';
import { MAX_EXCERPT_BYTES } from '../helpers/deriveExcerpt.ts';
import { type PassManifestEntry, validatePassManifest, writePassManifestEntry } from '../pass-manifest.ts';

const ROOT = '/repo';

const TREE_ID = 'tree-id';

describe(validatePassManifest, () => {
  it('keeps a valid entry at the root and at a workspace package', () => {
    const entries = [makeEntry(), makeEntry({ scope: 'packages/a', replay: undefined })];

    expect(validate(entries)).toStrictEqual(entries);
  });

  it.each([
    ['a missing field', { command: undefined }],
    ['a duration that is not a finite number', { durationMs: NaN }],
    ['a negative duration', { durationMs: -1 }],
    ['a replay line without an excerpt', { replay: [{ command: 'test', scope: 'a' }] }],
    ['a replay that is not a list', { replay: 'test passed' }],
  ])('drops an entry with %s', (_label, overrides) => {
    expect(validate([makeEntry(overrides)])).toStrictEqual([]);
  });

  it.each([
    ['an absolute scope', '/repo/packages/a'],
    ['a scope that escapes the root', '../x'],
    ['a scope that escapes through a workspace package', 'packages/a/../../x'],
    ['an empty scope', ''],
    ['a scope with a dot segment', './packages/a'],
    ['a scope that names neither the root nor a workspace package', 'packages/b'],
  ])('drops an entry with %s', (_label, scope) => {
    expect(validate([makeEntry({ scope })])).toStrictEqual([]);
  });

  it('drops an entry for a command that is not cacheable here', () => {
    expect(validate([makeEntry({ command: 'build' })])).toStrictEqual([]);
  });

  it('drops an entry for a command that the config excludes', () => {
    const entries = [makeEntry()];

    expect(validatePassManifest({ ...makeOptions(entries), checkCache: { excludeCommands: ['test'] } })).toStrictEqual(
      [],
    );
  });

  it('drops an entry that passed on another tree', () => {
    expect(validate([makeEntry({ treeHash: 'other-tree' })])).toStrictEqual([]);
  });

  it('drops an entry that replays an excerpt longer than a pass records, and keeps one at the bound', () => {
    const atBound = makeEntry({ replay: [{ command: 'test', excerpt: 'x'.repeat(MAX_EXCERPT_BYTES), scope: 'repo' }] });
    const overBound = makeEntry({
      replay: [{ command: 'test', excerpt: 'é'.repeat(MAX_EXCERPT_BYTES / 2 + 1), scope: 'repo' }],
    });

    expect(validate([atBound, overBound])).toStrictEqual([atBound]);
  });

  it('keeps the valid entries beside a rejected one, noting each rejection', () => {
    const stderr = captureStream();
    const valid = makeEntry();

    const kept = validatePassManifest({
      ...makeOptions(['not an entry', valid, makeEntry({ scope: '../x' })]),
      env: { [DEBUG_ENV_VAR]: '1' },
      stderr: stderr.stream,
    });

    expect(kept).toStrictEqual([valid]);
    expect(stderr.read()).toContain('the entry is malformed');
    expect(stderr.read()).toContain('test names a scope outside the workspace (../x)');
  });

  it('rejects a manifest of more than 1,000 entries whole', () => {
    expect(validate(Array.from({ length: 1_001 }, () => makeEntry()))).toStrictEqual([]);
    expect(validate(Array.from({ length: 1_000 }, () => makeEntry()))).toHaveLength(1_000);
  });
});

describe(writePassManifestEntry, () => {
  let tree: TempTree;
  let manifestDir: string;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({ 'manifest/': '' }, { prefix: 'nmr-pass-manifest-' }));
    manifestDir = tree.resolve('manifest');
  });

  it('writes one file per entry, naming the scope relative to the root', async () => {
    await writeEntry({ anchorDir: tree.resolve('packages/a') });
    await writeEntry({ anchorDir: tree.dir, command: 'ci' });

    expect(readEntries()).toStrictEqual(
      expect.arrayContaining([
        {
          command: 'test',
          commandString: 'vitest run',
          durationMs: 1_200,
          replay: [{ command: 'test', excerpt: '3 passed', scope: 'a' }],
          scope: 'packages/a',
          treeHash: 'tree-id',
        },
        expect.objectContaining({ command: 'ci', scope: '.' }),
      ]),
    );
    expect(readEntries()).toHaveLength(2);
  });

  it('leaves out the replay when there is nothing to replay', async () => {
    await writeEntry({ replay: undefined });
    await writeEntry({ replay: [] });

    expect(readEntries()).toStrictEqual([
      expect.not.objectContaining({ replay: expect.anything() }),
      expect.not.objectContaining({ replay: expect.anything() }),
    ]);
  });

  it('does not write anything when the variable is unset', async () => {
    await writeEntry({ env: {} });

    expect(tree.list('manifest')).toStrictEqual([]);
  });

  it('reports a directory that cannot be written in the debug note, without throwing', async () => {
    const stderr = captureStream();

    await writeEntry({
      env: { [DEBUG_ENV_VAR]: '1', [PASS_MANIFEST_DIR_ENV_VAR]: tree.resolve('missing') },
      stderr: stderr.stream,
    });

    expect(stderr.read()).toContain('could not report test to the delegating machine');
  });

  /** Writes an entry for `test` into the manifest directory, with any option overridden. */
  async function writeEntry(overrides: Partial<Parameters<typeof writePassManifestEntry>[0]> = {}): Promise<void> {
    await writePassManifestEntry({
      anchorDir: tree.dir,
      command: 'test',
      commandString: 'vitest run',
      durationMs: 1_200,
      env: { [PASS_MANIFEST_DIR_ENV_VAR]: manifestDir },
      monorepoRoot: tree.dir,
      replay: [{ command: 'test', excerpt: '3 passed', scope: 'a' }],
      stderr: new PassThrough(),
      treeHash: 'tree-id',
      ...overrides,
    });
  }

  /** Parses every file in the manifest directory. */
  function readEntries(): unknown[] {
    return tree.list('manifest').map((name): unknown => JSON.parse(tree.read(path.join('manifest', name))));
  }
});

// region | Helpers

/** Returns a valid entry for `test` at the root, with any field overridden, possibly into an invalid one. */
function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    command: 'test',
    commandString: 'vitest run',
    durationMs: 1_200,
    replay: [{ command: 'test', excerpt: '3 passed', scope: 'repo' }],
    scope: '.',
    treeHash: TREE_ID,
    ...overrides,
  };
}

/** Returns the options with which every validation test runs, against a root with one workspace package. */
function makeOptions(entries: readonly unknown[]): Parameters<typeof validatePassManifest>[0] {
  return {
    checkCache: undefined,
    entries,
    env: {},
    monorepoRoot: ROOT,
    stderr: new PassThrough(),
    treeId: TREE_ID,
    workspacePackageDirs: [path.join(ROOT, 'packages/a')],
  };
}

/** Validates entries against the default options. */
function validate(entries: readonly unknown[]): PassManifestEntry[] {
  return validatePassManifest(makeOptions(entries));
}

/** Returns a writable stream and a reader of everything written to it. */
function captureStream(): { read: () => string; stream: PassThrough } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  return { read: () => Buffer.concat(chunks).toString('utf8'), stream };
}

// endregion | Helpers
