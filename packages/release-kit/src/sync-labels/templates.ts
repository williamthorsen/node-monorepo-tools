import type { LabelDefinition } from './types.ts';

/** Generate the caller workflow YAML for `sync-labels`. */
export function syncLabelsWorkflow(): string {
  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Sync labels

on:
  workflow_dispatch:

jobs:
  sync:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.yaml@sync-labels-v1
`;
}

/** Generate scope labels from a list of workspace paths. */
export function buildScopeLabels(workspacePaths: string[]): LabelDefinition[] {
  const labels: LabelDefinition[] = [
    { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
  ];

  for (const workspacePath of workspacePaths) {
    const basename = workspacePath.split('/').pop() ?? workspacePath;
    labels.push({ name: `scope:${basename}`, color: '00ff96', description: `${basename} package` });
  }

  return labels;
}

/** Generate the `.config/sync-labels.config.ts` config file content. */
export function syncLabelsConfigScript(scopeLabels: LabelDefinition[]): string {
  const labelsArray = scopeLabels
    .map((label) => `  { name: '${label.name}', color: '${label.color}', description: '${label.description}' },`)
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
