import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findMonorepoRoot } from '../context.ts';

export { findMonorepoRoot } from '../context.ts';
import { getRuntimeVersionFromAsdf } from './helpers/get-runtime-version-from-asdf.ts';
import { getStringFromYamlFile } from './helpers/get-string-from-yaml-file.ts';
import { getValueAtPathOrThrow } from './helpers/get-value-at-path.ts';

const GITHUB_ACTION_FILE_PATH = '.github/workflows/code-quality.yaml';

export function checkPnpmVersionConsistency(monorepoRoot: string): void {
  describe('pnpm version consistency', () => {
    it('pnpm version is the same in GitHub action and package.json', async () => {
      const actionVersion = await getPnpmVersionFromAction(monorepoRoot);
      const packageJsonVersion = getPnpmVersionFromPackageJson(monorepoRoot);

      expect(actionVersion).toBe(packageJsonVersion);
    });
  });
}

export function checkNodeVersionConsistency(monorepoRoot: string): void {
  describe('Node.js version consistency', () => {
    it('version is the same in GitHub action and .tool-versions', async () => {
      const toolVersion = await getRuntimeVersionFromAsdf('nodejs', monorepoRoot);
      const actionVersion = await getNodeVersionFromAction(monorepoRoot);

      expect(toolVersion).toBe(actionVersion);
    });
  });
}

export async function getPnpmVersionFromAction(monorepoRoot: string): Promise<string> {
  const actionPath = path.join(monorepoRoot, GITHUB_ACTION_FILE_PATH);
  return getStringFromYamlFile(actionPath, 'jobs.code-quality.with.pnpm-version', 'pnpm version');
}

export function getPnpmVersionFromPackageJson(monorepoRoot: string): string {
  const pkgPath = path.join(monorepoRoot, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg: unknown = JSON.parse(raw);

  const pm = getValueAtPathOrThrow(pkg, 'packageManager');

  if (typeof pm !== 'string') {
    throw new TypeError('"packageManager" field missing or not a string in package.json.');
  }

  const [name, version] = pm.split('@');
  if (name !== 'pnpm') {
    throw new Error('packageManager is not pnpm.');
  }
  if (!version) {
    throw new Error('pnpm version missing in package.json.');
  }

  return version;
}

export async function getNodeVersionFromAction(monorepoRoot: string): Promise<string> {
  const actionPath = path.join(monorepoRoot, GITHUB_ACTION_FILE_PATH);
  return getStringFromYamlFile(actionPath, 'jobs.code-quality.with.node-version', 'Node.js version');
}

/**
 * Runs structural consistency checks for a PNPM monorepo.
 * Verifies that version numbers are consistent across config files.
 *
 * Call this from a test file in your monorepo:
 * ```ts
 * import { runConsistencyChecks } from '@williamthorsen/nmr/tests';
 * runConsistencyChecks();
 * ```
 */
export function runConsistencyChecks(): void {
  const monorepoRoot = findMonorepoRoot();

  checkPnpmVersionConsistency(monorepoRoot);
  checkNodeVersionConsistency(monorepoRoot);
}
