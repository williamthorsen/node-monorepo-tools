import { basename } from 'node:path';

import type { LabelDefinition } from './types.ts';

/** Generate the caller workflow YAML for `sync-labels`. */
export function syncLabelsWorkflow(): string {
  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Sync labels

on:
  workflow_dispatch:

  # Apply on merge, so that a regenerated labels file cannot sit unapplied.
  push:
    paths:
      - .github/labels.yaml

  # Preview on review: The check's log has a full computed diff, including deletions of labels not declared by the file.
  pull_request:
    paths:
      - .github/labels.yaml

# Permissions are fixed when a run is created and cannot vary by trigger within a job,
# so applying and previewing are separate jobs.
jobs:
  # The push arm applies on the default branch alone. # A \`branches:\` filter cannot name the # default branch,
  # so that the gate lives on the job and this file stays identical across repos.
  sync:
    if: github.event_name != 'pull_request' && (github.event_name != 'push' || github.ref_name == github.event.repository.default_branch)
    permissions:
      contents: read
      issues: write
    uses: williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@workflow/sync-labels-v1

  check:
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
      issues: read
    uses: williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@workflow/sync-labels-v1
    with:
      dry-run: true
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
