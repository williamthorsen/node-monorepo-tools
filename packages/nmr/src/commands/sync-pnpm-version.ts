import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { CodeQualityPnpmWorkflowSchema, getPnpmVersionNodes } from '../helpers/code-quality-pnpm-action.ts';
import { readPackageJson } from '../helpers/package-json.ts';

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
  console.info('Synchronizing pnpm version in GitHub workflow...');

  // Read the consumer's root package.json at runtime
  const pkg = readPackageJson(monorepoRoot);
  const pnpmVersion = extractPnpmVersion(pkg.packageManager);

  if (!pnpmVersion) {
    throw new Error(
      `Could not extract pnpm version from package.json packageManager field\npackageManager field: ${pkg.packageManager ?? '(not set)'}`,
    );
  }

  console.info(`Package.json pnpm version: ${pnpmVersion}`);

  // Parse as a document so comments, blank lines, and quote style survive the round-trip
  const workflowPath = path.join(monorepoRoot, WORKFLOW_RELATIVE_PATH);
  const doc = parseDocument(readFileSync(workflowPath, 'utf8'));

  const [parseError] = doc.errors;
  if (parseError) {
    throw new Error(`Failed to parse workflow file: ${workflowPath}\n${parseError.message}`);
  }

  // Guard: refuse to mutate a file that is not a recognizable code-quality workflow
  CodeQualityPnpmWorkflowSchema.parse(doc.toJS());

  const outdatedNodes = getPnpmVersionNodes(doc).filter((node) => String(node.value) !== pnpmVersion);

  if (outdatedNodes.length === 0) {
    console.info('Workflow pnpm version is already up to date');
    return;
  }

  for (const node of outdatedNodes) {
    node.value = pnpmVersion;
  }

  writeFileSync(workflowPath, doc.toString(), 'utf8');
  console.info(`✓ Updated ${outdatedNodes.length} pnpm-version occurrence(s) → ${pnpmVersion}`);
}

export { extractPnpmVersion };
