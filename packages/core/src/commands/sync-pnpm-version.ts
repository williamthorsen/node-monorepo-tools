import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CodeQualityPnpmWorkflowSchema, getPnpmVersion } from '../helpers/code-quality-pnpm-action.js';
import { readPackageJson } from '../helpers/package-json.js';
import { readYamlFile } from '../helpers/yaml-utils.js';

const WORKFLOW_RELATIVE_PATH = '.github/workflows/code-quality.yaml';

function extractPnpmVersion(packageManager: string | undefined): string | null {
  if (!packageManager) {
    return null;
  }
  const match = /^pnpm@(.+)$/.exec(packageManager);
  return match?.[1] ?? null;
}

/**
 * Synchronizes the pnpm version between package.json's packageManager field
 * and the GitHub code-quality workflow file.
 */
export function syncPnpmVersion(monorepoRoot: string): void {
  console.log('Synchronizing pnpm version in GitHub workflow...');

  // Read the consumer's root package.json at runtime
  const pkg = readPackageJson(monorepoRoot);
  const pnpmVersion = extractPnpmVersion(pkg.packageManager);

  if (!pnpmVersion) {
    console.error('Could not extract pnpm version from package.json packageManager field');
    console.error(`packageManager field: ${pkg.packageManager ?? '(not set)'}`);
    process.exit(1);
  }

  console.log(`Package.json pnpm version: ${pnpmVersion}`);

  // Read and validate workflow file
  const workflowPath = path.join(monorepoRoot, WORKFLOW_RELATIVE_PATH);
  const workflowData = readYamlFile(workflowPath);
  const workflow = CodeQualityPnpmWorkflowSchema.parse(workflowData);

  const currentWorkflowVersion = getPnpmVersion(workflow);
  console.log(`Current workflow pnpm version: ${currentWorkflowVersion}`);

  if (currentWorkflowVersion === pnpmVersion) {
    console.log('Workflow pnpm version is already up to date');
    return;
  }

  // Read original file content for targeted replacement (preserves formatting)
  const originalContent = readFileSync(workflowPath, 'utf8');
  const updatedContent = originalContent.replace(/(\s+pnpm-version:\s+)(['"]?)[\d.]+\2/, `$1$2${pnpmVersion}$2`);

  writeFileSync(workflowPath, updatedContent, 'utf8');
  console.log(`✓ Updated workflow pnpm version: ${currentWorkflowVersion} → ${pnpmVersion}`);
}

export { extractPnpmVersion };
