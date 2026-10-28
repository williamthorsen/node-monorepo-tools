import { join } from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { type OverrideTargetItem, validateAllChangelogOverrides } from '../validateAllChangelogOverrides.ts';

describe(validateAllChangelogOverrides, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'test-validate-overrides-' }));
  });

  it("doesn't report any findings when the caller doesn't provide any scope", () => {
    const result = validateAllChangelogOverrides({});
    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([]);
  });

  it("doesn't report any findings when override files are absent (missing files are no-ops)", () => {
    const result = validateAllChangelogOverrides({
      project: { filePath: join(tree.dir, 'missing-project.json'), items: toItems(['aaa1111']) },
      workspaces: [{ filePath: join(tree.dir, 'missing-workspace.json'), items: toItems(['bbb2222']) }],
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([]);
  });

  it("doesn't report any findings on a clean run with all matched keys", () => {
    const projectFilePath = tree.writeJson('overrides.json', { aaa1111: { audience: 'skip' } });
    const workspaceFilePath = tree.writeJson('workspace-a/overrides.json', { bbb2222: { description: 'Cleaned' } });

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath },
      workspaces: [{ filePath: workspaceFilePath, items: toItems(['aaa1111aaa', 'bbb2222bbb']) }],
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([]);
  });

  it('reports schema/parse errors with the file path prefix', () => {
    const projectFilePath = tree.write('overrides.json', '{not-valid');
    const workspaceFilePath = tree.write('workspace-a/overrides.json', '[]');

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath, items: toItems([]) },
      workspaces: [{ filePath: workspaceFilePath, items: toItems([]) }],
    });

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain(projectFilePath);
    expect(result.errors[0]).toMatch(/Failed to parse override file/);
    expect(result.errors[1]).toContain(workspaceFilePath);
    expect(result.errors[1]).toMatch(/top-level value must be an object/);
  });

  it('reports per-key validation errors with the file path prefix', () => {
    const projectFilePath = tree.writeJson('overrides.json', { abc: { unknown: true } });

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath, items: toItems([]) },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(projectFilePath);
    expect(result.errors[0]).toMatch(/unknown field 'unknown'/);
  });

  it('reports ambiguous-prefix errors at workspace tier with the workspace file path', () => {
    const workspaceFilePath = tree.writeJson('workspace-a/overrides.json', { abc: { audience: 'skip' } });

    const result = validateAllChangelogOverrides({
      workspaces: [{ filePath: workspaceFilePath, items: toItems(['abc111', 'abc222']) }],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(workspaceFilePath);
    expect(result.errors[0]).toMatch(/ambiguous/);
  });

  it('reports ambiguous-prefix errors at project tier with the project file path', () => {
    const projectFilePath = tree.writeJson('overrides.json', { abc: { audience: 'skip' } });

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath, items: toItems(['abc111', 'abc222']) },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(projectFilePath);
    expect(result.errors[0]).toMatch(/ambiguous/);
  });

  it('attributes a project-tier ambiguous-prefix error to the project file when detected via a workspace hash window', () => {
    // The project key 'abc' resolves ambiguously against workspace A's hashes. The validator must
    // attribute the error to the project file (where 'abc' lives), not the workspace file (which
    // is empty).
    const projectFilePath = tree.writeJson('overrides.json', { abc: { audience: 'skip' } });
    const workspaceFilePath = tree.write('workspace-a/overrides.json', '{}');

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath },
      workspaces: [{ filePath: workspaceFilePath, items: toItems(['abc111aaa', 'abc222bbb']) }],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(projectFilePath);
    expect(result.errors[0]).not.toContain(workspaceFilePath);
    expect(result.errors[0]).toMatch(/ambiguous/);
  });

  it('warns on a workspace-tier stale key with the workspace file path', () => {
    const workspaceFilePath = tree.writeJson('workspace-a/overrides.json', { dead012: { audience: 'skip' } });

    const result = validateAllChangelogOverrides({
      workspaces: [{ filePath: workspaceFilePath, items: toItems(['real0001', 'real0002']) }],
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(workspaceFilePath);
    expect(result.warnings[0]).toContain("'dead012'");
    expect(result.warnings[0]).toMatch(/this workspace's history/);
  });

  it('warns on a root-tier key not matched in any scope', () => {
    const projectFilePath = tree.writeJson('overrides.json', { dead099: { audience: 'skip' } });
    const workspaceFilePath = tree.write('workspace-a/overrides.json', '{}');

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath },
      workspaces: [{ filePath: workspaceFilePath, items: toItems(['real1234']) }],
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(projectFilePath);
    expect(result.warnings[0]).toContain("'dead099'");
    expect(result.warnings[0]).toMatch(/any scope/);
  });

  it('does NOT warn on a root key matched in some workspace', () => {
    const projectFilePath = tree.writeJson('overrides.json', { aaa1111: { audience: 'skip' } });
    const aFilePath = tree.write('a/overrides.json', '{}');
    const bFilePath = tree.write('b/overrides.json', '{}');

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath },
      workspaces: [
        { filePath: aFilePath, items: toItems(['aaa1111ext']) },
        { filePath: bFilePath, items: toItems(['unrelated']) },
      ],
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([]);
  });

  it('does NOT warn on a root key matched only in the project release window', () => {
    const projectFilePath = tree.writeJson('overrides.json', { aaa1111: { audience: 'skip' } });
    const workspaceFilePath = tree.write('workspace-a/overrides.json', '{}');

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath, items: toItems(['aaa1111ext']) },
      workspaces: [{ filePath: workspaceFilePath, items: toItems(['unrelated']) }],
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([]);
  });

  it('treats a root key as stale when it is shadowed everywhere and never matches at the root tier', () => {
    // Root key 'aaa1111' is shadowed by an identical workspace key in the only workspace.
    // The workspace match counts toward the workspace tier, not the root, and the project scope
    // doesn't have a release window, so the root key matches nowhere and should be flagged stale.
    const projectFilePath = tree.writeJson('overrides.json', { aaa1111: { audience: 'skip' } });
    const workspaceFilePath = tree.writeJson('workspace-a/overrides.json', {
      aaa1111: { description: 'Workspace wins' },
    });

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath },
      workspaces: [{ filePath: workspaceFilePath, items: toItems(['aaa1111ext']) }],
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(projectFilePath);
    expect(result.warnings[0]).toContain("'aaa1111'");
  });

  it('reports both errors and warnings simultaneously when both classes occur', () => {
    const projectFilePath = tree.writeJson('overrides.json', { dead099: { audience: 'skip' } });
    const workspaceFilePath = tree.writeJson('workspace-a/overrides.json', { abc: { audience: 'skip' } });

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath },
      workspaces: [{ filePath: workspaceFilePath, items: toItems(['abc111', 'abc222']) }],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/ambiguous/);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("'dead099'");
  });

  it('warns on an ordinal key whose entry position the commit lacks', () => {
    const workspaceFilePath = tree.writeJson('workspace-a/overrides.json', { 'abc111:3': { audience: 'skip' } });

    const result = validateAllChangelogOverrides({
      workspaces: [
        {
          filePath: workspaceFilePath,
          items: [
            { hash: 'abc111', entry: 1 },
            { hash: 'abc111', entry: 2 },
          ],
        },
      ],
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([
      `${workspaceFilePath}: Override key 'abc111:3' did not match any item in this workspace's history (likely a stale reference)`,
    ]);
  });

  it('does not warn on an ordinal key that matches an item', () => {
    const projectFilePath = tree.writeJson('overrides.json', { 'abc111:2': { description: 'Second' } });

    const result = validateAllChangelogOverrides({
      project: {
        filePath: projectFilePath,
        items: [
          { hash: 'abc111', entry: 1 },
          { hash: 'abc111', entry: 2 },
        ],
      },
    });

    expect(result).toStrictEqual({ errors: [], warnings: [] });
  });

  it('reports an ordinal key with an ambiguous prefix as an error and not as stale', () => {
    const projectFilePath = tree.writeJson('overrides.json', { 'abc:1': { audience: 'skip' } });

    const result = validateAllChangelogOverrides({
      project: {
        filePath: projectFilePath,
        items: [
          { hash: 'abc111', entry: 1 },
          { hash: 'abc222', entry: 1 },
        ],
      },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(`${projectFilePath}: Override key 'abc:1' is ambiguous`);
    expect(result.warnings).toStrictEqual([]);
  });

  it('reports a bare key that sets a field on a commit with several items', () => {
    const projectFilePath = tree.writeJson('overrides.json', { abc: { description: 'Reworded' } });

    const result = validateAllChangelogOverrides({
      project: {
        filePath: projectFilePath,
        items: [
          { hash: 'abc111', entry: 1 },
          { hash: 'abc111', entry: 2 },
        ],
      },
    });

    expect(result).toStrictEqual({
      errors: [
        `${projectFilePath}: Override key 'abc' sets description on a commit with several items; use abc:1, abc:2`,
      ],
      warnings: [],
    });
  });

  it('reports overlapping keys in one file against that file, once', () => {
    const projectFilePath = tree.writeJson('overrides.json', { beef: { audience: 'skip' } });
    const workspaceFilePath = tree.writeJson('workspace-a/overrides.json', {
      abc: { breaking: true },
      'abc111:2': { description: 'Second' },
    });

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath },
      workspaces: [
        {
          filePath: workspaceFilePath,
          items: [{ hash: 'abc111', entry: 1 }, { hash: 'abc111', entry: 2 }, { hash: 'beef01' }],
        },
      ],
    });

    expect(result).toStrictEqual({
      errors: [`${workspaceFilePath}: Override keys 'abc' and 'abc111:2' both match the item at abc111:2; keep one`],
      warnings: [],
    });
  });

  it('reports a root key and a workspace key that match the same item against the workspace file', () => {
    const projectFilePath = tree.writeJson('overrides.json', { abc111: { audience: 'skip' } });
    const workspaceFilePath = tree.writeJson('workspace-a/overrides.json', { 'abc111:1': { description: 'First' } });

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath },
      workspaces: [
        {
          filePath: workspaceFilePath,
          items: [
            { hash: 'abc111', entry: 1 },
            { hash: 'abc111', entry: 2 },
          ],
        },
      ],
    });

    expect(result).toStrictEqual({
      errors: [`${workspaceFilePath}: Override keys 'abc111' and 'abc111:1' both match the item at abc111:1; keep one`],
      warnings: [],
    });
  });

  it('handles single-package mode (project scope only, without workspaces)', () => {
    const projectFilePath = tree.writeJson('overrides.json', {
      aaa1111: { audience: 'skip' },
      dead099: { audience: 'skip' },
    });

    const result = validateAllChangelogOverrides({
      project: { filePath: projectFilePath, items: toItems(['aaa1111ext']) },
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("'dead099'");
  });
});

// region | Helpers

/** Builds title-derived override target items from commit hashes. */
function toItems(hashes: string[]): OverrideTargetItem[] {
  return hashes.map((hash) => ({ hash }));
}

// endregion | Helpers
