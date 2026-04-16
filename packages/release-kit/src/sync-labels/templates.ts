import { basename } from 'node:path';

import type { LabelDefinition } from './types.ts';

/** Generate the caller workflow YAML for `sync-labels`. */
export function syncLabelsWorkflow(): string {
  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Sync labels

on:
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  sync:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@workflow/sync-labels-v1
`;
}

/** Generate scope labels from a list of workspace paths. */
export function buildScopeLabels(workspacePaths: string[]): LabelDefinition[] {
  const labels: LabelDefinition[] = [
    { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
  ];

  for (const workspacePath of workspacePaths) {
    const name = basename(workspacePath);
    labels.push({ name: `scope:${name}`, color: '00ff96', description: `${name} package` });
  }

  return labels;
}

/** Escape a value for embedding in a single-quoted TypeScript string literal. */
function escapeForSingleQuotedString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, String.raw`\'`);
}

/** Generate the `.config/sync-labels.config.ts` config file content. */
export function syncLabelsConfigScript(scopeLabels: LabelDefinition[]): string {
  const labelsArray = scopeLabels
    .map((label) => {
      const name = escapeForSingleQuotedString(label.name);
      const color = escapeForSingleQuotedString(label.color);
      const description = escapeForSingleQuotedString(label.description);
      return `    { name: '${name}', color: '${color}', description: '${description}' },`;
    })
    .join('\n');

  return `import type { SyncLabelsConfig } from '@williamthorsen/release-kit';

const config: SyncLabelsConfig = {
  presets: ['common'],
  labels: [
${labelsArray}
  ],
};

export default config;
`;
}
