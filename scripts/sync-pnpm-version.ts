/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

/**
 * Synchronize pnpm version in GitHub workflow with package.json packageManager field
 */

import { readFileSync, writeFileSync } from 'node:fs';

import rootPackageJson from '../package.json' with { type: 'json' };
import { CodeQualityPnpmWorkflowSchema, getPnpmVersion } from './helpers/code-quality-pnpm-action.ts';
import { readYamlFile } from './helpers/yaml-utils.ts';

const WORKFLOW_PATH = '.github/workflows/code-quality.yaml';

function extractPnpmVersion(packageManager: string | undefined): string | null {
  if (!packageManager) {
    return null;
  }

  // packageManager format: "pnpm@10.18.3"
  const match = /^pnpm@(.+)$/.exec(packageManager);
  return match?.[1] ?? null;
}

function syncPnpmVersion(): void {
  console.log('Synchronizing pnpm version in GitHub workflow...');

  // Get pnpm version from package.json
  const packageManagerField = rootPackageJson.packageManager;
  const pnpmVersion = extractPnpmVersion(packageManagerField);

  if (!pnpmVersion) {
    console.error('Could not extract pnpm version from package.json packageManager field');
    console.error(`packageManager field: ${packageManagerField}`);
    process.exit(1);
  }

  console.log(`Package.json pnpm version: ${pnpmVersion}`);

  // Read and validate workflow file
  const workflowData = readYamlFile(WORKFLOW_PATH);
  const workflow = CodeQualityPnpmWorkflowSchema.parse(workflowData);

  // Get current workflow pnpm version
  const currentWorkflowVersion = getPnpmVersion(workflow);

  console.log(`Current workflow pnpm version: ${currentWorkflowVersion}`);

  // Check if update is needed
  if (currentWorkflowVersion === pnpmVersion) {
    console.log('Workflow pnpm version is already up to date');
    return;
  }

  // Read original file content for targeted replacement
  const originalContent = readFileSync(WORKFLOW_PATH, 'utf8');

  // Replace the pnpm-version value using regex
  const updatedContent = originalContent.replace(/(\s+pnpm-version:\s+)(['"]?)[\d.]+\2/, `$1$2${pnpmVersion}$2`);

  // Write updated content
  writeFileSync(WORKFLOW_PATH, updatedContent, 'utf8');

  console.log(`✓ Updated workflow pnpm version: ${currentWorkflowVersion} → ${pnpmVersion}`);
}

function main(): void {
  try {
    syncPnpmVersion();
  } catch (error) {
    console.error('Error synchronizing pnpm version:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { extractPnpmVersion, syncPnpmVersion };
