import { join } from 'node:path';

import { createTempTree, pointCwdAt, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyChangelogOverrides } from '../applyChangelogOverrides.ts';
import {
  applyWorkspaceOverrides,
  composeOverrides,
  createOverrideContext,
  loadOverridesForScopes,
  type OverrideContext,
  resolveOverridePath,
} from '../changelogOverrides.ts';
import type { ChangelogEntry, ChangelogOverride } from '../types.ts';

describe(resolveOverridePath, () => {
  it('resolves the project-tier convention for the repo root', () => {
    expect(resolveOverridePath('.')).toBe('.meta/changelog-overrides.json');
  });

  it('resolves the workspace-tier convention for a workspace path', () => {
    expect(resolveOverridePath('packages/foo')).toBe('packages/foo/.meta/changelog-overrides.json');
  });
});

describe(loadOverridesForScopes, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'test-overrides-scopes-' }));
  });

  it("returns empty maps when the caller doesn't request any scope", () => {
    const result = loadOverridesForScopes({});
    expect(result.projectOverrides.size).toBe(0);
    expect(result.overridesByWorkspace.size).toBe(0);
    expect(result.errors).toStrictEqual([]);
  });

  it('treats missing files as empty maps', () => {
    const result = loadOverridesForScopes({
      projectPath: join(tree.dir, 'project'),
      workspaces: [join(tree.dir, 'workspace-a')],
    });
    expect(result.projectOverrides.size).toBe(0);
    expect(result.overridesByWorkspace.size).toBe(0);
    expect(result.errors).toStrictEqual([]);
  });

  it('loads project and per-workspace overrides into separate maps', () => {
    const projectRoot = join(tree.dir, 'project');
    const workspaceRoot = join(tree.dir, 'packages/foo');
    tree.writeJson('project/.meta/changelog-overrides.json', { aaa1111: { audience: 'skip' } });
    tree.writeJson('packages/foo/.meta/changelog-overrides.json', { bbb2222: { description: 'Renamed' } });

    const result = loadOverridesForScopes({ projectPath: projectRoot, workspaces: [workspaceRoot] });
    expect(result.errors).toStrictEqual([]);
    expect(result.projectOverrides.get('aaa1111')).toStrictEqual({ audience: 'skip' });
    expect(result.overridesByWorkspace.get(workspaceRoot)?.get('bbb2222')).toStrictEqual({ description: 'Renamed' });
  });

  it('omits per-workspace entries when the workspace file is empty', () => {
    const workspaceRoot = join(tree.dir, 'packages/empty');
    tree.write('packages/empty/.meta/changelog-overrides.json', '{}');

    const result = loadOverridesForScopes({ workspaces: [workspaceRoot] });
    expect(result.errors).toStrictEqual([]);
    expect(result.overridesByWorkspace.has(workspaceRoot)).toBe(false);
  });

  it('aggregates errors across multiple malformed files into one report', () => {
    const projectRoot = join(tree.dir, 'project');
    const aWorkspaceDir = join(tree.dir, 'packages/a');
    const bWorkspaceDir = join(tree.dir, 'packages/b');
    tree.write('project/.meta/changelog-overrides.json', '{not-valid');
    tree.write('packages/a/.meta/changelog-overrides.json', '[]');
    tree.writeJson('packages/b/.meta/changelog-overrides.json', { beef01: { audience: 'skip' } });

    const result = loadOverridesForScopes({
      projectPath: projectRoot,
      workspaces: [aWorkspaceDir, bWorkspaceDir],
    });
    expect(result.errors.some((message) => message.includes('Failed to parse override file'))).toBe(true);
    expect(result.errors.some((message) => message.includes('top-level value must be an object'))).toBe(true);
    // The valid file is still loaded so that the report is comprehensive even when peers fail.
    expect(result.overridesByWorkspace.get(bWorkspaceDir)?.get('beef01')).toStrictEqual({ audience: 'skip' });
  });
});

describe(composeOverrides, () => {
  it('returns a fresh map containing only root entries when workspace is undefined', () => {
    const rootOverrides = new Map<string, ChangelogOverride>([
      ['aaa', { audience: 'skip' }],
      ['bbb', { description: 'Replacement' }],
    ]);
    const composedOverrides = composeOverrides(rootOverrides, undefined);
    expect(composedOverrides).not.toBe(rootOverrides);
    expect(composedOverrides.size).toBe(2);
    expect(composedOverrides.get('aaa')).toStrictEqual({ audience: 'skip' });
    expect(composedOverrides.get('bbb')).toStrictEqual({ description: 'Replacement' });
  });

  it('shadows root entries on byte-equal keys (workspace wins, without a field-level merge)', () => {
    const rootOverrides = new Map<string, ChangelogOverride>([
      ['aaa', { audience: 'skip', description: 'Root description' }],
    ]);
    const workspaceOverrides = new Map<string, ChangelogOverride>([['aaa', { description: 'Workspace description' }]]);
    const composedOverrides = composeOverrides(rootOverrides, workspaceOverrides);
    // The workspace entry replaces the root entry entirely: `audience` is gone.
    expect(composedOverrides.get('aaa')).toStrictEqual({ description: 'Workspace description' });
  });

  it('preserves disjoint root entries when workspace adds new keys', () => {
    const rootOverrides = new Map<string, ChangelogOverride>([['aaa', { audience: 'skip' }]]);
    const workspaceOverrides = new Map<string, ChangelogOverride>([['bbb', { description: 'New' }]]);
    const composedOverrides = composeOverrides(rootOverrides, workspaceOverrides);
    expect(composedOverrides.get('aaa')).toStrictEqual({ audience: 'skip' });
    expect(composedOverrides.get('bbb')).toStrictEqual({ description: 'New' });
  });

  it('does not mutate the input maps', () => {
    const rootOverrides = new Map<string, ChangelogOverride>([['aaa', { audience: 'skip' }]]);
    const workspaceOverrides = new Map<string, ChangelogOverride>([['aaa', { description: 'Override' }]]);
    composeOverrides(rootOverrides, workspaceOverrides);
    expect(rootOverrides.get('aaa')).toStrictEqual({ audience: 'skip' });
    expect(workspaceOverrides.get('aaa')).toStrictEqual({ description: 'Override' });
  });
});

describe(applyWorkspaceOverrides, () => {
  function makeEntry(hashes: string[]): ChangelogEntry {
    return {
      version: '1.0.0',
      date: '2024-01-01',
      sections: [
        {
          title: 'Features',
          audience: 'all',
          items: hashes.map((hash) => ({ description: `Item ${hash}`, hash })),
        },
      ],
    };
  }

  function makeContext(
    projectOverrides: Map<string, ChangelogOverride>,
    overridesByWorkspace: Map<string, Map<string, ChangelogOverride>>,
  ): OverrideContext {
    return {
      projectOverrides,
      overridesByWorkspace,
      overrideWarnings: [],
      globalMatchedRootKeys: new Set<string>(),
    };
  }

  it('applies root-only overrides and tracks them in globalMatchedRootKeys', () => {
    const context = makeContext(new Map([['aaa1111', { audience: 'skip' }]]), new Map());
    const entries = [makeEntry(['aaa1111'])];
    const appliedResult = applyWorkspaceOverrides(entries, 'packages/foo', context);
    expect(appliedResult.entries[0]?.sections).toHaveLength(0);
    expect(context.globalMatchedRootKeys).toStrictEqual(new Set(['aaa1111']));
    expect(context.overrideWarnings).toStrictEqual([]);
  });

  it('applies per-workspace-only overrides without touching globalMatchedRootKeys', () => {
    const context = makeContext(
      new Map(),
      new Map([['packages/foo', new Map([['bbb2222', { description: 'Workspace override' }]])]]),
    );
    const entries = [makeEntry(['bbb2222'])];
    const appliedResult = applyWorkspaceOverrides(entries, 'packages/foo', context);
    expect(appliedResult.entries[0]?.sections[0]?.items[0]?.description).toBe('Workspace override');
    expect(context.globalMatchedRootKeys.size).toBe(0);
    expect(context.overrideWarnings).toStrictEqual([]);
  });

  it('applies disjoint root and workspace keys side-by-side', () => {
    const context = makeContext(
      new Map([['aaa1111', { audience: 'skip' }]]),
      new Map([['packages/foo', new Map([['bbb2222', { description: 'Workspace replacement' }]])]]),
    );
    const entries = [makeEntry(['aaa1111', 'bbb2222'])];
    const appliedResult = applyWorkspaceOverrides(entries, 'packages/foo', context);
    const items = appliedResult.entries[0]?.sections[0]?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.hash).toBe('bbb2222');
    expect(items[0]?.description).toBe('Workspace replacement');
    expect(context.globalMatchedRootKeys).toStrictEqual(new Set(['aaa1111']));
    expect(context.overrideWarnings).toStrictEqual([]);
  });

  it('shadows the root entry on byte-equal keys (workspace wins; root match not recorded)', () => {
    const context = makeContext(
      new Map([['aaa1111', { audience: 'skip', description: 'Root description' }]]),
      new Map([['packages/foo', new Map([['aaa1111', { description: 'Workspace description' }]])]]),
    );
    const entries = [makeEntry(['aaa1111'])];
    const appliedResult = applyWorkspaceOverrides(entries, 'packages/foo', context);
    // The workspace entry replaces the root entry entirely: `audience: 'skip'` is gone.
    expect(appliedResult.entries[0]?.sections[0]?.items[0]?.description).toBe('Workspace description');
    // The shadowed root key must NOT count as a global root match; otherwise an end-of-run
    // stale check would conclude that the root key matched somewhere.
    expect(context.globalMatchedRootKeys.size).toBe(0);
    expect(context.overrideWarnings).toStrictEqual([]);
  });

  it('throws when a root key and a non-identical workspace key match the same item', () => {
    const context = makeContext(
      new Map([['aaa1111', { audience: 'skip' }]]),
      new Map([['packages/foo', new Map([['aaa1111:1', { description: 'Workspace description' }]])]]),
    );
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Item', hash: 'aaa1111', entry: 1 }] }],
      },
    ];
    expect(() => applyWorkspaceOverrides(entries, 'packages/foo', context)).toThrow(
      "Override keys 'aaa1111' and 'aaa1111:1' both match the item at aaa1111:1; keep one",
    );
  });

  it('emits an immediate stale-key warning for an unmatched per-workspace key', () => {
    const context = makeContext(
      new Map(),
      new Map([
        [
          'packages/foo',
          new Map<string, ChangelogOverride>([
            ['bbb2222', { audience: 'skip' }],
            ['ccc3333', { audience: 'skip' }],
          ]),
        ],
      ]),
    );
    const entries = [makeEntry(['bbb2222'])];
    applyWorkspaceOverrides(entries, 'packages/foo', context);
    expect(context.overrideWarnings).toHaveLength(1);
    expect(context.overrideWarnings[0]).toContain("'ccc3333'");
    expect(context.overrideWarnings[0]).toMatch(/stale reference/);
  });

  // The project-release flow sees only `context.project`, so a per-workspace key that targets one of the
  // project's commits doesn't have any effect at the project tier.
  it('does not apply per-workspace files at the project tier (as the project tier applies them)', () => {
    const context = makeContext(
      new Map([['aaa1111', { audience: 'skip' }]]),
      new Map([['packages/foo', new Map([['bbb2222', { audience: 'skip' }]])]]),
    );
    const projectEntries = [makeEntry(['aaa1111', 'bbb2222'])];
    const appliedResult = applyChangelogOverrides(projectEntries, context.projectOverrides);
    const remainingHashes = appliedResult.entries[0]?.sections[0]?.items.map((item) => item.hash) ?? [];
    // aaa1111 is dropped via the root override; bbb2222 remains because the workspace file
    // does not apply at the project tier.
    expect(remainingHashes).toStrictEqual(['bbb2222']);
  });
});

describe(createOverrideContext, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'test-create-context-' }));
    disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
  });

  it('aborts with a combined error when a per-workspace file is malformed', () => {
    const workspacePath = 'packages/bad';
    tree.write(`${workspacePath}/.meta/changelog-overrides.json`, '{not-valid');

    expect(() => createOverrideContext([workspacePath])).toThrow(/Failed to load changelog overrides/);
  });

  it('aborts with a combined error when the project file is malformed', () => {
    tree.write('.meta/changelog-overrides.json', '[]');

    expect(() => createOverrideContext([])).toThrow(/Failed to load changelog overrides/);
  });

  it("returns an empty context when the tree doesn't contain any override file", () => {
    const context = createOverrideContext(['packages/foo']);
    expect(context.projectOverrides.size).toBe(0);
    expect(context.overridesByWorkspace.size).toBe(0);
    expect(context.overrideWarnings).toStrictEqual([]);
    expect(context.globalMatchedRootKeys.size).toBe(0);
  });

  it('loads project and per-workspace files into a populated context', () => {
    tree.writeJson('.meta/changelog-overrides.json', { aaa1111: { audience: 'skip' } });
    tree.writeJson('packages/foo/.meta/changelog-overrides.json', {
      bbb2222: { description: 'Workspace replacement' },
    });

    const context = createOverrideContext(['packages/foo']);
    expect(context.projectOverrides.get('aaa1111')).toStrictEqual({ audience: 'skip' });
    expect(context.overridesByWorkspace.get('packages/foo')?.get('bbb2222')).toStrictEqual({
      description: 'Workspace replacement',
    });
  });
});
