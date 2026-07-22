import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { isRecord } from '../../typeGuards.ts';
import { syncLabelsConfigScript, syncLabelsWorkflow } from '../templates.ts';
import type { LabelDefinition } from '../types.ts';

const REUSABLE_USES =
  'williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@workflow/sync-labels-v1';

const parsedWorkflow: unknown = parse(syncLabelsWorkflow());

describe(syncLabelsWorkflow, () => {
  it('triggers on manual dispatch, on push, and on pull requests touching the labels file', () => {
    expect(readPath('on')).toHaveProperty('workflow_dispatch');
    expect(readPath('on.push.paths')).toEqual(['.github/labels.yaml']);
    expect(readPath('on.pull_request.paths')).toEqual(['.github/labels.yaml']);
  });

  it('applies labels from a write-scoped job that skips pull requests', () => {
    expect(readPath('jobs.sync.if')).toContain("github.event_name != 'pull_request'");
    expect(readPath('jobs.sync.permissions')).toEqual({ contents: 'read', issues: 'write' });
    expect(readPath('jobs.sync.uses')).toBe(REUSABLE_USES);
    expect(readPath('jobs.sync.with')).toBeUndefined();
  });

  // The template ships to repos whose default branch is not `main`; a branch filter on the
  // trigger, or a literal comparison in the gate, would leave those repos never applying on merge.
  it('gates the apply job on the repository default branch, naming no branch literally', () => {
    expect(readPath('jobs.sync.if')).toContain('github.ref_name == github.event.repository.default_branch');
    expect(readPath('on.push.branches')).toBeUndefined();
  });

  it('previews labels from a read-only pull-request job running in dry-run', () => {
    expect(readPath('jobs.check.if')).toBe("github.event_name == 'pull_request'");
    expect(readPath('jobs.check.permissions')).toEqual({ contents: 'read', issues: 'read' });
    expect(readPath('jobs.check.uses')).toBe(REUSABLE_USES);
    expect(readPath('jobs.check.with')).toEqual({ 'dry-run': true });
  });

  it('declares no workflow-level permissions, so the check job cannot inherit write access', () => {
    expect(readPath('permissions')).toBeUndefined();
  });

  it('includes the yaml-language-server schema comment', () => {
    expect(syncLabelsWorkflow()).toContain(
      '# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json',
    );
  });
});

describe(syncLabelsConfigScript, () => {
  it('contains the expected import and export lines', () => {
    const result = syncLabelsConfigScript([]);

    expect(result).toContain("import type { SyncLabelsConfig } from '@williamthorsen/release-kit'");
    expect(result).toContain('export default config;');
    expect(result).toContain('const config: SyncLabelsConfig');
  });

  it('produces valid output with an empty scope labels array', () => {
    const result = syncLabelsConfigScript([]);

    expect(result).toContain("presets: ['common']");
    expect(result).toContain('labels: [');
    expect(result).toContain('],');
  });

  it('indents label objects by 4 spaces', () => {
    const scopeLabels: LabelDefinition[] = [
      { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
    ];

    const result = syncLabelsConfigScript(scopeLabels);

    expect(result).toContain("    { name: 'scope:root'");
  });

  it('interpolates scope labels correctly', () => {
    const scopeLabels: LabelDefinition[] = [
      { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
      { name: 'scope:my-package', color: '00ff96', description: 'my-package package' },
    ];

    const result = syncLabelsConfigScript(scopeLabels);

    expect(result).toContain("name: 'scope:root'");
    expect(result).toContain("name: 'scope:my-package'");
    expect(result).toContain("description: 'Monorepo root configuration'");
  });

  it('escapes single quotes in label values', () => {
    const scopeLabels: LabelDefinition[] = [
      { name: "scope:it's-a-package", color: '00ff96', description: "it's a package" },
    ];

    const result = syncLabelsConfigScript(scopeLabels);

    expect(result).toContain(String.raw`name: 'scope:it\'s-a-package'`);
    expect(result).toContain(String.raw`description: 'it\'s a package'`);
  });

  it('escapes backslashes in label values', () => {
    const scopeLabels: LabelDefinition[] = [
      { name: String.raw`scope:back\slash`, color: '00ff96', description: String.raw`has \ backslash` },
    ];

    const result = syncLabelsConfigScript(scopeLabels);

    expect(result).toContain(String.raw`name: 'scope:back\\slash'`);
    expect(result).toContain(String.raw`description: 'has \\ backslash'`);
  });
});

/** Read a dot-separated path out of the parsed caller workflow, yielding `undefined` if any segment is missing. */
function readPath(path: string): unknown {
  let node: unknown = parsedWorkflow;
  for (const key of path.split('.')) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}
