import { describe, expect, it } from 'vitest';

import { syncLabelsConfigScript, syncLabelsWorkflow } from '../templates.ts';
import type { LabelDefinition } from '../types.ts';

describe(syncLabelsWorkflow, () => {
  it('produces a workflow_dispatch trigger that calls the reusable workflow', () => {
    const result = syncLabelsWorkflow();

    expect(result).toContain('workflow_dispatch:');
    expect(result).toContain(
      'uses: williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@workflow/sync-labels-v1',
    );
  });

  it('includes permissions for contents and issues', () => {
    const result = syncLabelsWorkflow();

    expect(result).toContain('permissions:');
    expect(result).toContain('contents: read');
    expect(result).toContain('issues: write');
  });

  it('includes the yaml-language-server schema comment', () => {
    const result = syncLabelsWorkflow();

    expect(result).toContain('# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json');
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
