import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { findPackageRoot } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import type { LabelDefinition } from './types.ts';

/** Reads the bundled caller workflow for `sync-labels`. Throws if the template cannot be read. */
export function readSyncLabelsWorkflowTemplate(): string {
  const templatePath = resolve(findPackageRoot(import.meta.url), 'templates', 'sync-labels.yaml.template');
  try {
    return readFileSync(templatePath, 'utf8');
  } catch (error: unknown) {
    throw new Error(`Failed to read bundled template at ${templatePath}: ${describeError(error)}`, { cause: error });
  }
}

/**
 * Generates scope labels from workspace paths and retired-package names.
 *
 * Workspace labels are named after the path basename; retired-package labels after the unscoped package name.
 * None has a description: GitHub renders a described label taller and more prominently than a bare one, and
 * the scope labels are meant to appear as a compact group.
 * Describing only the retired scopes would single them out for that prominence.
 */
export function buildScopeLabels(workspacePaths: string[], retiredNames: string[] = []): LabelDefinition[] {
  const scopes = ['root', ...workspacePaths.map((workspacePath) => basename(workspacePath)), ...retiredNames];

  return scopes.map((scope) => ({ name: `scope:${scope}`, color: '00ff96' }));
}

/** Escapes a value for embedding in a single-quoted TypeScript string literal. */
function escapeForSingleQuotedString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, String.raw`\'`);
}

/**
 * Renders the `repoLabels` config block, indented for pasting into the object passed to `defineConfig` in
 * `.config/release-kit.config.ts`.
 */
export function renderRepoLabelsBlock(scopeLabels: LabelDefinition[]): string {
  const entries = scopeLabels
    .map((label) => {
      const name = escapeForSingleQuotedString(label.name);
      const color = escapeForSingleQuotedString(label.color);
      const descriptionClause =
        label.description === undefined ? '' : `, description: '${escapeForSingleQuotedString(label.description)}'`;
      return `      '${name}': { color: '${color}'${descriptionClause} },`;
    })
    .join('\n');

  const labelsBlock = entries === '' ? '    labels: {},' : `    labels: {\n${entries}\n    },`;

  return `  repoLabels: {
    extends: ['common'],
${labelsBlock}
  },`;
}

/** Renders a new `.config/release-kit.config.ts` containing the `repoLabels` block. */
export function renderRepoLabelsConfigScript(scopeLabels: LabelDefinition[]): string {
  return `import { defineConfig } from '@williamthorsen/release-kit/config';

export default defineConfig({
${renderRepoLabelsBlock(scopeLabels)}
});
`;
}
