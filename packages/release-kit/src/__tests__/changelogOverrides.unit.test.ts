import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyChangelogOverrides,
  applyWorkspaceOverrides,
  composeOverrides,
  createOverrideContext,
  formatStaleOverrideKeyWarning,
  loadChangelogOverrides,
  loadOverridesForScopes,
  type OverrideContext,
  resolveOverridePath,
  validateChangelogOverrides,
} from '../changelogOverrides.ts';
import type { ChangelogEntry, ChangelogOverride, WorkspaceConfig } from '../types.ts';

describe(loadChangelogOverrides, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-overrides-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns an empty map when the file does not exist', () => {
    const result = loadChangelogOverrides(join(tempDir, 'missing.json'));
    expect(result).toStrictEqual({ overrides: new Map() });
  });

  it('returns an error when the file contains malformed JSON', () => {
    const filePath = join(tempDir, 'overrides.json');
    writeFileSync(filePath, '{not-valid', 'utf8');

    const result = loadChangelogOverrides(filePath);
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatch(/Failed to parse override file/);
  });

  it('returns an error when the top-level JSON is not an object', () => {
    const filePath = join(tempDir, 'overrides.json');
    writeFileSync(filePath, '[]', 'utf8');

    const result = loadChangelogOverrides(filePath);
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatch(/top-level value must be an object/);
  });

  it('parses a valid override file into a Map', () => {
    const filePath = join(tempDir, 'overrides.json');
    writeFileSync(
      filePath,
      JSON.stringify({
        '8296231': { audience: 'skip' },
        abc1234d: { body: 'Replacement body' },
      }),
      'utf8',
    );

    const result = loadChangelogOverrides(filePath);
    expect('overrides' in result).toBe(true);
    if (!('overrides' in result)) return;
    expect(result.overrides.get('8296231')).toStrictEqual({ audience: 'skip' });
    expect(result.overrides.get('abc1234d')).toStrictEqual({ body: 'Replacement body' });
  });
});

describe(validateChangelogOverrides, () => {
  it('rejects a non-record top-level value', () => {
    const result = validateChangelogOverrides(42);
    expect(result.errors).toContain('Override file: top-level value must be an object keyed by commit hash');
  });

  it('rejects a non-record entry value', () => {
    const result = validateChangelogOverrides({ abc: 'not-an-object' });
    expect(result.errors).toContain("overrides['abc']: must be an object");
  });

  it('rejects unknown fields with the offending key in the error message', () => {
    const result = validateChangelogOverrides({ abc: { audience: 'skip', unknown: true } });
    expect(result.errors).toContain("overrides['abc']: unknown field 'unknown'");
  });

  it('rejects an entry with no fields', () => {
    const result = validateChangelogOverrides({ abc: {} });
    expect(result.errors).toContain("overrides['abc']: at least one override field must be set");
  });

  it("accepts audience: 'skip' as the v1-supported value", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'skip' } });
    expect(result.errors).toStrictEqual([]);
    expect(result.overrides.get('abc')).toStrictEqual({ audience: 'skip' });
  });

  it("rejects audience: 'all' with an explicit not-yet-supported message", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'all' } });
    expect(result.errors[0]).toMatch(/audience 'all' is not yet supported/);
  });

  it("rejects audience: 'dev' with an explicit not-yet-supported message", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'dev' } });
    expect(result.errors[0]).toMatch(/audience 'dev' is not yet supported/);
  });

  it('rejects an unknown audience value with the union enumerated', () => {
    const result = validateChangelogOverrides({ abc: { audience: 'maybe' } });
    expect(result.errors[0]).toMatch(/'audience' must be one of 'all' \| 'dev' \| 'skip'/);
  });

  it('rejects non-string description', () => {
    const result = validateChangelogOverrides({ abc: { description: 42 } });
    expect(result.errors).toContain("overrides['abc']: 'description' must be a string");
  });

  it('rejects non-string body', () => {
    const result = validateChangelogOverrides({ abc: { body: 42 } });
    expect(result.errors).toContain("overrides['abc']: 'body' must be a string");
  });

  it('rejects non-boolean breaking', () => {
    const result = validateChangelogOverrides({ abc: { breaking: 'yes' } });
    expect(result.errors).toContain("overrides['abc']: 'breaking' must be a boolean");
  });

  it('parses an entry with description, body, and breaking fields', () => {
    const result = validateChangelogOverrides({
      abc: { description: 'New', body: 'Detail', breaking: true },
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.overrides.get('abc')).toStrictEqual({ description: 'New', body: 'Detail', breaking: true });
  });

  it('rejects an empty-string key', () => {
    const result = validateChangelogOverrides({ '': { audience: 'skip' } });
    expect(result.errors[0]).toMatch(/empty-string key/);
  });
});

describe(applyChangelogOverrides, () => {
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

  it('returns a fresh-array no-op when overrides map is empty', () => {
    const entries = [makeEntry(['abc1234'])];
    const result = applyChangelogOverrides(entries, new Map());
    expect(result.entries).not.toBe(entries);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Item abc1234');
    expect(result.warnings).toStrictEqual([]);
    expect(result.errors).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual([]);
  });

  it('matches a full hash and applies the override', () => {
    const entries = [makeEntry(['abc1234567890'])];
    const overrides = new Map([['abc1234567890', { description: 'Replacement description' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Replacement description');
    expect(result.errors).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual(['abc1234567890']);
  });

  it('matches a short prefix when only one hash starts with it', () => {
    const entries = [makeEntry(['abc1234567890', 'def4567890'])];
    const overrides = new Map([['abc12', { description: 'Short-prefix match' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Short-prefix match');
    expect(result.entries[0]?.sections[0]?.items[1]?.description).toBe('Item def4567890');
  });

  it('reports an error when a prefix matches multiple hashes', () => {
    const entries = [makeEntry(['abc111', 'abc222'])];
    const overrides = new Map([['abc', { description: 'Ambiguous' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.errors[0]).toMatch(/ambiguous/);
    expect(result.errors[0]).toContain('abc111');
    expect(result.errors[0]).toContain('abc222');
    // No mutation when ambiguous.
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Item abc111');
  });

  it('omits a zero-match key from matchedKeys (caller decides whether to warn)', () => {
    const entries = [makeEntry(['abc111'])];
    const overrides = new Map([['xyz999', { description: 'Stale' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    // The applier no longer emits per-batch zero-match warnings; the orchestrator
    // aggregates `matchedKeys` across batches and warns on globally-stale keys exactly once.
    expect(result.warnings).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Item abc111');
  });

  it("drops an item when audience is 'skip'", () => {
    const entries = [makeEntry(['abc1234'])];
    const overrides = new Map([['abc1234', { audience: 'skip' as const }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections).toHaveLength(0);
  });

  it('prunes a section that becomes empty after skipping its only item', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          { title: 'Features', audience: 'all', items: [{ description: 'Item 1', hash: 'abc111' }] },
          { title: 'Bug fixes', audience: 'all', items: [{ description: 'Item 2', hash: 'def222' }] },
        ],
      },
    ];
    const overrides = new Map([['abc111', { audience: 'skip' as const }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections).toHaveLength(1);
    expect(result.entries[0]?.sections[0]?.title).toBe('Bug fixes');
  });

  it('keeps the version visible even when all sections are pruned', () => {
    const entries = [makeEntry(['abc111', 'abc222'])];
    const overrides = new Map([
      ['abc111', { audience: 'skip' as const }],
      ['abc222', { audience: 'skip' as const }],
    ]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.sections).toHaveLength(0);
  });

  it('overrides the body of a single item', () => {
    const entries = [makeEntry(['abc1234'])];
    const overrides = new Map([['abc1234', { body: 'Cleaned-up body text' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.body).toBe('Cleaned-up body text');
  });

  it('toggles breaking on an existing item', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [{ description: 'Item', hash: 'abc1234', breaking: true }],
          },
        ],
      },
    ];
    const overrides = new Map([['abc1234', { breaking: false }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.breaking).toBe(false);
  });

  it('passes synthetic items (no hash) through untouched', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Dependency updates',
            audience: 'dev',
            items: [{ description: 'Bumped foo to 1.0.0' }],
          },
        ],
      },
    ];
    const overrides = new Map([['anything', { description: 'Should not match' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Bumped foo to 1.0.0');
    expect(result.warnings).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual([]);
  });

  it('reports each matched key in matchedKeys with no warnings or errors', () => {
    const entries = [makeEntry(['abc1234', 'def5678'])];
    const overrides = new Map([
      ['abc1234', { description: 'First' }],
      ['def5678', { description: 'Second' }],
    ]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(new Set(result.matchedKeys)).toStrictEqual(new Set(['abc1234', 'def5678']));
    expect(result.warnings).toStrictEqual([]);
    expect(result.errors).toStrictEqual([]);
  });

  it('omits ambiguous-prefix keys from matchedKeys and surfaces an error instead', () => {
    const entries = [makeEntry(['abc111', 'abc222'])];
    const overrides = new Map([['abc', { description: 'Ambiguous' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.errors[0]).toMatch(/ambiguous/);
  });

  it('does not mutate the input entries (purity check)', () => {
    const entries = [makeEntry(['abc1234'])];
    const snapshot = structuredClone(entries);
    const overrides = new Map([['abc1234', { description: 'Replacement' }]]);
    applyChangelogOverrides(entries, overrides);
    expect(entries).toStrictEqual(snapshot);
  });
});

describe(formatStaleOverrideKeyWarning, () => {
  it('includes the offending key and a stale-reference hint', () => {
    const message = formatStaleOverrideKeyWarning('abc1234');
    expect(message).toContain("'abc1234'");
    expect(message).toMatch(/stale reference/);
  });
});

describe(resolveOverridePath, () => {
  it('resolves the project-tier convention for the repo root', () => {
    expect(resolveOverridePath('.')).toBe('.meta/changelog-overrides.json');
  });

  it('resolves the workspace-tier convention for a workspace path', () => {
    expect(resolveOverridePath('packages/foo')).toBe('packages/foo/.meta/changelog-overrides.json');
  });
});

describe(loadOverridesForScopes, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-overrides-scopes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty maps when no scopes are requested', () => {
    const result = loadOverridesForScopes({});
    expect(result.project.size).toBe(0);
    expect(result.perWorkspace.size).toBe(0);
    expect(result.errors).toStrictEqual([]);
  });

  it('treats missing files as empty maps', () => {
    const result = loadOverridesForScopes({
      project: join(tempDir, 'project'),
      workspaces: [join(tempDir, 'workspace-a')],
    });
    expect(result.project.size).toBe(0);
    expect(result.perWorkspace.size).toBe(0);
    expect(result.errors).toStrictEqual([]);
  });

  it('loads project and per-workspace overrides into separate maps', () => {
    const projectRoot = join(tempDir, 'project');
    const workspaceRoot = join(tempDir, 'packages/foo');
    mkdirSync(join(projectRoot, '.meta'), { recursive: true });
    mkdirSync(join(workspaceRoot, '.meta'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.meta/changelog-overrides.json'),
      JSON.stringify({ aaa1111: { audience: 'skip' } }),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, '.meta/changelog-overrides.json'),
      JSON.stringify({ bbb2222: { description: 'Renamed' } }),
      'utf8',
    );

    const result = loadOverridesForScopes({ project: projectRoot, workspaces: [workspaceRoot] });
    expect(result.errors).toStrictEqual([]);
    expect(result.project.get('aaa1111')).toStrictEqual({ audience: 'skip' });
    expect(result.perWorkspace.get(workspaceRoot)?.get('bbb2222')).toStrictEqual({ description: 'Renamed' });
  });

  it('omits per-workspace entries when the workspace file is empty', () => {
    const workspaceRoot = join(tempDir, 'packages/empty');
    mkdirSync(join(workspaceRoot, '.meta'), { recursive: true });
    writeFileSync(join(workspaceRoot, '.meta/changelog-overrides.json'), '{}', 'utf8');

    const result = loadOverridesForScopes({ workspaces: [workspaceRoot] });
    expect(result.errors).toStrictEqual([]);
    expect(result.perWorkspace.has(workspaceRoot)).toBe(false);
  });

  it('aggregates errors across multiple malformed files into one report', () => {
    const projectRoot = join(tempDir, 'project');
    const workspaceA = join(tempDir, 'packages/a');
    const workspaceB = join(tempDir, 'packages/b');
    mkdirSync(join(projectRoot, '.meta'), { recursive: true });
    mkdirSync(join(workspaceA, '.meta'), { recursive: true });
    mkdirSync(join(workspaceB, '.meta'), { recursive: true });
    writeFileSync(join(projectRoot, '.meta/changelog-overrides.json'), '{not-valid', 'utf8');
    writeFileSync(join(workspaceA, '.meta/changelog-overrides.json'), '[]', 'utf8');
    writeFileSync(
      join(workspaceB, '.meta/changelog-overrides.json'),
      JSON.stringify({ valid1: { audience: 'skip' } }),
      'utf8',
    );

    const result = loadOverridesForScopes({
      project: projectRoot,
      workspaces: [workspaceA, workspaceB],
    });
    expect(result.errors.some((message) => message.includes('Failed to parse override file'))).toBe(true);
    expect(result.errors.some((message) => message.includes('top-level value must be an object'))).toBe(true);
    // The valid file is still loaded so the report is comprehensive even when peers fail.
    expect(result.perWorkspace.get(workspaceB)?.get('valid1')).toStrictEqual({ audience: 'skip' });
  });
});

describe(composeOverrides, () => {
  it('returns a fresh map containing only root entries when workspace is undefined', () => {
    const root = new Map<string, ChangelogOverride>([
      ['aaa', { audience: 'skip' }],
      ['bbb', { description: 'Replacement' }],
    ]);
    const composed = composeOverrides(root, undefined);
    expect(composed).not.toBe(root);
    expect(composed.size).toBe(2);
    expect(composed.get('aaa')).toStrictEqual({ audience: 'skip' });
    expect(composed.get('bbb')).toStrictEqual({ description: 'Replacement' });
  });

  it('shadows root entries on byte-equal keys (workspace wins, no field-level merge)', () => {
    const root = new Map<string, ChangelogOverride>([['aaa', { audience: 'skip', description: 'Root description' }]]);
    const workspace = new Map<string, ChangelogOverride>([['aaa', { description: 'Workspace description' }]]);
    const composed = composeOverrides(root, workspace);
    // Workspace entry replaces the root entry entirely — note `audience` is gone.
    expect(composed.get('aaa')).toStrictEqual({ description: 'Workspace description' });
  });

  it('preserves disjoint root entries when workspace adds new keys', () => {
    const root = new Map<string, ChangelogOverride>([['aaa', { audience: 'skip' }]]);
    const workspace = new Map<string, ChangelogOverride>([['bbb', { description: 'New' }]]);
    const composed = composeOverrides(root, workspace);
    expect(composed.get('aaa')).toStrictEqual({ audience: 'skip' });
    expect(composed.get('bbb')).toStrictEqual({ description: 'New' });
  });

  it('does not mutate the input maps', () => {
    const root = new Map<string, ChangelogOverride>([['aaa', { audience: 'skip' }]]);
    const workspace = new Map<string, ChangelogOverride>([['aaa', { description: 'Override' }]]);
    composeOverrides(root, workspace);
    expect(root.get('aaa')).toStrictEqual({ audience: 'skip' });
    expect(workspace.get('aaa')).toStrictEqual({ description: 'Override' });
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
    project: Map<string, ChangelogOverride>,
    perWorkspace: Map<string, Map<string, ChangelogOverride>>,
  ): OverrideContext {
    return {
      project,
      perWorkspace,
      overrideWarnings: [],
      globalMatchedRootKeys: new Set<string>(),
    };
  }

  // Scenario 1: root-only overrides apply across workspaces.
  it('applies root-only overrides and tracks them in globalMatchedRootKeys', () => {
    const context = makeContext(new Map([['aaa1111', { audience: 'skip' }]]), new Map());
    const entries = [makeEntry(['aaa1111'])];
    const applied = applyWorkspaceOverrides(entries, 'packages/foo', context);
    expect(applied.entries[0]?.sections).toHaveLength(0);
    expect(context.globalMatchedRootKeys).toStrictEqual(new Set(['aaa1111']));
    expect(context.overrideWarnings).toStrictEqual([]);
  });

  // Scenario 2: per-workspace-only overrides are isolated to that workspace.
  it('applies per-workspace-only overrides without touching globalMatchedRootKeys', () => {
    const context = makeContext(
      new Map(),
      new Map([['packages/foo', new Map([['bbb2222', { description: 'Workspace override' }]])]]),
    );
    const entries = [makeEntry(['bbb2222'])];
    const applied = applyWorkspaceOverrides(entries, 'packages/foo', context);
    expect(applied.entries[0]?.sections[0]?.items[0]?.description).toBe('Workspace override');
    expect(context.globalMatchedRootKeys.size).toBe(0);
    expect(context.overrideWarnings).toStrictEqual([]);
  });

  // Scenario 3: disjoint root + workspace keys both apply.
  it('applies disjoint root and workspace keys side-by-side', () => {
    const context = makeContext(
      new Map([['aaa1111', { audience: 'skip' }]]),
      new Map([['packages/foo', new Map([['bbb2222', { description: 'Workspace replacement' }]])]]),
    );
    const entries = [makeEntry(['aaa1111', 'bbb2222'])];
    const applied = applyWorkspaceOverrides(entries, 'packages/foo', context);
    const items = applied.entries[0]?.sections[0]?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.hash).toBe('bbb2222');
    expect(items[0]?.description).toBe('Workspace replacement');
    expect(context.globalMatchedRootKeys).toStrictEqual(new Set(['aaa1111']));
    expect(context.overrideWarnings).toStrictEqual([]);
  });

  // Scenario 4: byte-equal-key shadowing — workspace entry wins entirely; root not counted as matched.
  it('shadows the root entry on byte-equal keys (workspace wins; root match not recorded)', () => {
    const context = makeContext(
      new Map([['aaa1111', { audience: 'skip', description: 'Root description' }]]),
      new Map([['packages/foo', new Map([['aaa1111', { description: 'Workspace description' }]])]]),
    );
    const entries = [makeEntry(['aaa1111'])];
    const applied = applyWorkspaceOverrides(entries, 'packages/foo', context);
    // Workspace entry replaced root entry entirely — `audience: 'skip'` is gone.
    expect(applied.entries[0]?.sections[0]?.items[0]?.description).toBe('Workspace description');
    // Root key was shadowed; it must NOT count as a global root match — otherwise an end-of-run
    // stale check would incorrectly conclude the root key matched somewhere.
    expect(context.globalMatchedRootKeys.size).toBe(0);
    expect(context.overrideWarnings).toStrictEqual([]);
  });

  // Scenario 6: a workspace key that doesn't match in its own workspace warns immediately.
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

  // Scenario 7: project changelog isolation. The project-release flow only ever sees
  // `context.project`; per-workspace files MUST NOT apply at the project tier. We verify by
  // reproducing the project-flow apply call (`applyChangelogOverrides(entries, context.project)`)
  // and confirming a per-workspace key targeting one of the project's commits has no effect.
  it("does not apply per-workspace files at the project tier (mimics releasePrepareProject's apply call)", () => {
    const context = makeContext(
      new Map([['aaa1111', { audience: 'skip' }]]),
      new Map([['packages/foo', new Map([['bbb2222', { audience: 'skip' }]])]]),
    );
    const projectEntries = [makeEntry(['aaa1111', 'bbb2222'])];
    // Project flow uses `context.project` only — never the composed map.
    const applied = applyChangelogOverrides(projectEntries, context.project);
    const remainingHashes = applied.entries[0]?.sections[0]?.items.map((item) => item.hash) ?? [];
    // aaa1111 is dropped via the root override; bbb2222 remains because the workspace file
    // does not apply at the project tier.
    expect(remainingHashes).toStrictEqual(['bbb2222']);
  });
});

describe(createOverrideContext, () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = join(tmpdir(), `test-create-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeWorkspace(workspacePath: string): WorkspaceConfig {
    return {
      dir: workspacePath.split('/').pop() ?? workspacePath,
      name: workspacePath,
      tagPrefix: 'v',
      workspacePath,
      isPublishable: false,
      packageFiles: [],
      changelogPaths: [workspacePath],
      paths: [`${workspacePath}/**`],
    };
  }

  // Scenario 5: any malformed file aborts the run before any writes — both root and workspace.
  it('aborts with a combined error when a per-workspace file is malformed', () => {
    const workspacePath = 'packages/bad';
    mkdirSync(join(tempDir, workspacePath, '.meta'), { recursive: true });
    writeFileSync(join(tempDir, workspacePath, '.meta/changelog-overrides.json'), '{not-valid', 'utf8');

    expect(() => createOverrideContext([makeWorkspace(workspacePath)])).toThrow(/Failed to load changelog overrides/);
  });

  it('aborts with a combined error when the project file is malformed', () => {
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    writeFileSync(join(tempDir, '.meta/changelog-overrides.json'), '[]', 'utf8');

    expect(() => createOverrideContext([])).toThrow(/Failed to load changelog overrides/);
  });

  it('returns an empty context when no override files exist', () => {
    const context = createOverrideContext([makeWorkspace('packages/foo')]);
    expect(context.project.size).toBe(0);
    expect(context.perWorkspace.size).toBe(0);
    expect(context.overrideWarnings).toStrictEqual([]);
    expect(context.globalMatchedRootKeys.size).toBe(0);
  });

  it('loads project and per-workspace files into a populated context', () => {
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    mkdirSync(join(tempDir, 'packages/foo/.meta'), { recursive: true });
    writeFileSync(
      join(tempDir, '.meta/changelog-overrides.json'),
      JSON.stringify({ aaa1111: { audience: 'skip' } }),
      'utf8',
    );
    writeFileSync(
      join(tempDir, 'packages/foo/.meta/changelog-overrides.json'),
      JSON.stringify({ bbb2222: { description: 'Workspace replacement' } }),
      'utf8',
    );

    const context = createOverrideContext([makeWorkspace('packages/foo')]);
    expect(context.project.get('aaa1111')).toStrictEqual({ audience: 'skip' });
    expect(context.perWorkspace.get('packages/foo')?.get('bbb2222')).toStrictEqual({
      description: 'Workspace replacement',
    });
  });
});
