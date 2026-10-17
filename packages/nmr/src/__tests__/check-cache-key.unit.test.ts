import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TreeSnapshot } from '../check-cache.ts';
import { computeCacheKey, computeRetentionKey } from '../check-cache-key.ts';
import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

const SNAPSHOT: TreeSnapshot = { treeId: 'tree-id', headSha: 'head-sha' };

describe('check-cache', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({ 'node_modules/': '' }, { prefix: 'nmr-check-cache-' }));
  });

  describe(computeCacheKey, () => {
    beforeEach(() => {
      writeInstallFingerprint(tree);
    });

    it('agrees with itself on unchanged inputs', () => {
      expect(requireKey(tree.dir)).toBe(requireKey(tree.dir));
    });

    it.each([
      ['the tree', { snapshot: { treeId: 'other-tree', headSha: 'head-sha' } }],
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
    ])('changes when %s changes', (_label, overrides) => {
      expect(requireKey(tree.dir, overrides)).not.toBe(requireKey(tree.dir));
    });

    it('changes when the scope changes', () => {
      // One tree can pass `check` at the root and fail it in a package; the two are different questions.
      expect(requireKey(tree.dir, { anchorDir: tree.resolve('packages/a') })).not.toBe(requireKey(tree.dir));
    });

    it('changes when what is installed changes', () => {
      const beforeKey = requireKey(tree.dir);

      tree.write('node_modules/.modules.yaml', 'hoistPattern:\n  - "*"\n');

      expect(requireKey(tree.dir)).not.toBe(beforeKey);
    });

    it('separates an unset environment variable from one set to the empty string', () => {
      expect(requireKey(tree.dir, { env: { TZ: '' } })).not.toBe(requireKey(tree.dir, { env: {} }));
    });

    it('ignores an environment variable outside the fixed set', () => {
      // The set stays fixed so that two machines differing only in shell decoration agree on the key.
      expect(requireKey(tree.dir, { env: { EDITOR: 'vim' } })).toBe(requireKey(tree.dir));
    });

    // Loudness changes what a run prints and never what it concludes, so a quiet run hits a pass that a loud one
    // recorded. Folding it in would split every recorded pass across the two modes, and silently.
    it('ignores the verbosity that a run was asked for', () => {
      expect(requireKey(tree.dir, { env: { [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' } })).toBe(
        requireKey(tree.dir, { env: { [COMMAND_VERBOSITY_ENV_VAR]: 'full' } }),
      );
    });

    // Because a command never sees the format in which nmr reports its own verdicts, the format cannot change
    // what the command concludes.
    it('ignores the format in which a run reports', () => {
      expect(requireKey(tree.dir, { env: { [REPORT_FORMAT_ENV_VAR]: 'json' } })).toBe(
        requireKey(tree.dir, { env: { [REPORT_FORMAT_ENV_VAR]: 'text' } }),
      );
    });

    it('refuses a key when the install fingerprint is unreadable', () => {
      tree.rm('node_modules/.pnpm');

      expect(computeCacheKey(buildKeyOptions(tree.dir))).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('install fingerprint'),
      });
    });
  });

  describe(computeRetentionKey, () => {
    it('agrees with itself on unchanged inputs', () => {
      expect(buildRetentionKey()).toBe(buildRetentionKey());
    });

    it.each([
      ['CI', { env: { CI: '1' } }],
      ['COLUMNS', { env: { COLUMNS: '80' } }],
      ['FORCE_COLOR', { env: { FORCE_COLOR: '3' } }],
      ['NO_COLOR', { env: { NO_COLOR: '1' } }],
      ['TERM', { env: { TERM: 'dumb' } }],
    ])('changes when %s changes', (_label, overrides) => {
      expect(buildRetentionKey(overrides)).not.toBe(buildRetentionKey());
    });

    it.each([
      ['stdout', { channels: { stderr: 'pipe', stdout: 1 } }],
      ['stderr', { channels: { stderr: 2, stdout: 'pipe' } }],
    ] as const)('changes when the channel on which %s ran changes', (_label, overrides) => {
      expect(buildRetentionKey(overrides)).not.toBe(buildRetentionKey());
    });

    // The number names which terminal a command wrote to, not whether what it wrote was a transcript.
    it('ignores which descriptor a stream ran on', () => {
      expect(buildRetentionKey({ channels: { stderr: 2, stdout: 1 } })).toBe(
        buildRetentionKey({ channels: { stderr: 9, stdout: 8 } }),
      );
    });

    // A machine-readable run is quiet, so it leaves a command on the same channels as a quiet run and replays
    // what one recorded. Folding the format in would split every retained excerpt across the two.
    it('ignores the format in which a run reports', () => {
      expect(buildRetentionKey({ env: { [REPORT_FORMAT_ENV_VAR]: 'json' } })).toBe(
        buildRetentionKey({ env: { [REPORT_FORMAT_ENV_VAR]: 'text' } }),
      );
    });

    it('changes when the pass that it certifies changes', () => {
      expect(buildRetentionKey({ passKey: 'another-pass' })).not.toBe(buildRetentionKey());
    });

    it('separates an unset environment variable from one set to the empty string', () => {
      expect(buildRetentionKey({ env: { TERM: '' } })).not.toBe(buildRetentionKey({ env: {} }));
    });

    it('ignores an environment variable outside the fixed set', () => {
      expect(buildRetentionKey({ env: { EDITOR: 'vim' } })).toBe(buildRetentionKey());
    });

    describe('against the pass key', () => {
      beforeEach(() => {
        writeInstallFingerprint(tree);
      });

      it('given a presentation variable, changes while the pass key stays the same', () => {
        const passKey = requireKey(tree.dir, { env: { COLUMNS: '80' } });

        expect(passKey).toBe(requireKey(tree.dir));
        expect(buildRetentionKey({ env: { COLUMNS: '80' }, passKey })).not.toBe(buildRetentionKey({ passKey }));
      });

      it('given a channel kind, changes while the pass key stays the same', () => {
        expect(buildRetentionKey({ channels: { stderr: 2, stdout: 1 }, passKey: requireKey(tree.dir) })).not.toBe(
          buildRetentionKey({ passKey: requireKey(tree.dir) }),
        );
      });
    });
  });
});

// region | Helpers

/** Returns the key for a set of inputs, failing the test if a key could not be computed. */
function requireKey(root: string, overrides: Partial<Parameters<typeof computeCacheKey>[0]> = {}): string {
  const result = computeCacheKey({ ...buildKeyOptions(root), ...overrides });
  if (!result.ok) {
    throw new Error(`expected a key, got: ${result.reason}`);
  }
  return result.key;
}

/** Builds the baseline key inputs, of which each test varies one ingredient. */
function buildKeyOptions(root: string): Parameters<typeof computeCacheKey>[0] {
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

/** Returns the retention key for the baseline inputs, varied by `overrides`. */
function buildRetentionKey(overrides: Partial<Parameters<typeof computeRetentionKey>[0]> = {}): string {
  return computeRetentionKey({
    channels: { stderr: 'pipe', stdout: 'pipe' },
    env: {},
    passKey: 'a-pass-key',
    ...overrides,
  });
}

/** Writes the pnpm files read by the install fingerprint. */
function writeInstallFingerprint(tree: TempTree): void {
  tree.writeAll({
    'node_modules/.modules.yaml': 'hoistPattern:\n  - "types"\n',
    'node_modules/.pnpm/lock.yaml': 'lockfileVersion: "9.0"\n',
  });
}

// endregion | Helpers
