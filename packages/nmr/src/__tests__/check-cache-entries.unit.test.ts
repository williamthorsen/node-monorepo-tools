import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TreeSnapshot } from '../check-cache.ts';
import {
  type CheckCacheEntry,
  readCheckCacheEntry,
  readTranscript,
  recordTranscript,
  removeCheckCache,
  writeCheckCacheEntry,
} from '../check-cache-entries.ts';

const SNAPSHOT: TreeSnapshot = { treeId: 'tree-id', headSha: 'head-sha' };

describe('check-cache', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({ 'node_modules/': '' }, { prefix: 'nmr-check-cache-' }));
  });

  describe('recorded entries', () => {
    it('reads back what it recorded', async () => {
      const entry = makeEntry();
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci', entry });

      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' }),
      ).resolves.toStrictEqual(entry);
    });

    it('does not report an entry for a command that never recorded one', async () => {
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

    it('reads an entry recorded before retention existed as a pass with nothing to replay', async () => {
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
    ])('reads an entry claiming %s as a pass with nothing to replay', async (_label, retention) => {
      // What a skip would have replayed cannot decide whether the pass beneath it stands.
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci', entry: makeEntry() });
      overwriteEntries(tree, JSON.stringify({ ...makeEntry(), retention }));

      const entry = await readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' });

      expect(entry?.key).toBe('a-key');
      expect(entry?.retention).toBeUndefined();
    });

    it('reads an entry of the wrong shape as absent', async () => {
      // An entry written in an older format is not a pass that anyone can act on.
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci', entry: makeEntry() });
      overwriteEntries(tree, JSON.stringify({ treeHash: 'tree-hash' }));

      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' }),
      ).resolves.toBeUndefined();
    });

    it('clears every scope’s entries at once', async () => {
      // One removal clears the whole table, so distrusting the cache never means searching through packages.
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

    /** Builds the ref for this test's temporary root, which `beforeEach` creates afresh. */
    function buildRef(command: string, anchorDir?: string) {
      return { ...REF, anchorDir: anchorDir ?? tree.dir, command, monorepoRoot: tree.dir };
    }

    it('reads back what it recorded', async () => {
      await recordTranscript(buildRef('test'), 'Test Files  6 passed (6)\n');

      await expect(readTranscript(buildRef('test'))).resolves.toBe('Test Files  6 passed (6)\n');
    });

    it('reports none for a command that recorded none', async () => {
      await expect(readTranscript(buildRef('typecheck'))).resolves.toBeUndefined();
    });

    it('keeps one command’s transcript separate from another’s', async () => {
      await recordTranscript(buildRef('test'), 'test output');
      await recordTranscript(buildRef('typecheck'), 'typecheck output');

      await expect(readTranscript(buildRef('test'))).resolves.toBe('test output');
    });

    it('keeps one scope’s transcript separate from another’s', async () => {
      const packageDir = tree.resolve('packages/a');
      await recordTranscript(buildRef('test'), 'root output');
      await recordTranscript(buildRef('test', packageDir), 'package output');

      await expect(readTranscript(buildRef('test', packageDir))).resolves.toBe('package output');
    });

    // A composite retains nothing of its own, so a leaf's transcript left in place beside its entry would be
    // dated by a run that never produced it.
    it('withdraws what an earlier pass left when this pass retained nothing', async () => {
      await recordTranscript(buildRef('test'), 'an earlier run');

      await recordTranscript(buildRef('test'), undefined);

      await expect(readTranscript(buildRef('test'))).resolves.toBeUndefined();
    });

    it('leaves the entry beside it alone', async () => {
      await writeCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'test', entry: makeEntry() });

      await recordTranscript(buildRef('test'), undefined);

      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'test' }),
      ).resolves.toBeDefined();
    });

    it('is cleared with the passes to which it belongs', async () => {
      await recordTranscript(buildRef('test'), 'test output');

      await removeCheckCache(tree.dir);

      await expect(readTranscript(buildRef('test'))).resolves.toBeUndefined();
    });
  });
});

// region | Helpers

/** Builds a valid entry, so that a test varies only the field that it is about. */
function makeEntry(overrides: Partial<CheckCacheEntry> = {}): CheckCacheEntry {
  return {
    key: 'a-key',
    treeHash: SNAPSHOT.treeId,
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

/** Replaces the content of every recorded entry, standing in for one written in an older format. */
function overwriteEntries(tree: TempTree, content: string): void {
  const cacheDir = 'node_modules/.cache/nmr-check';
  for (const entry of tree.list(cacheDir)) {
    tree.write(`${cacheDir}/${entry}`, content);
  }
}

// endregion | Helpers
