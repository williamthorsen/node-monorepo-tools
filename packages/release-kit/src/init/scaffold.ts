import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { writeFileWithCheck } from '@williamthorsen/node-monorepo-core';
import type { WriteResult } from '@williamthorsen/node-monorepo-core';

import { findPackageRoot } from '../findPackageRoot.ts';
import type { RepoType } from './detectRepoType.ts';
import { releaseConfigScript, releaseWorkflow } from './templates.ts';

interface ScaffoldOptions {
  repoType: RepoType;
  dryRun: boolean;
  overwrite: boolean;
  withConfig: boolean;
}

/** Copy the bundled cliff.toml.template to `.config/git-cliff.toml` in the target repo. */
export function copyCliffTemplate(dryRun: boolean, overwrite: boolean): WriteResult {
  const destPath = '.config/git-cliff.toml';
  const root = findPackageRoot(import.meta.url);
  const templatePath = resolve(root, 'cliff.toml.template');

  if (!existsSync(templatePath)) {
    console.error(`Could not find bundled template at ${templatePath}`);
    return { filePath: destPath, outcome: 'failed' };
  }

  let content: string;
  try {
    content = readFileSync(templatePath, 'utf8');
  } catch (error: unknown) {
    console.error(`Failed to read template ${templatePath}: ${error instanceof Error ? error.message : String(error)}`);
    return { filePath: destPath, outcome: 'failed' };
  }

  return writeFileWithCheck(destPath, content, { dryRun, overwrite });
}

/** Scaffold release-kit files for the target repo. Returns a result for each file attempted. */
export function scaffoldFiles({ repoType, dryRun, overwrite, withConfig }: ScaffoldOptions): WriteResult[] {
  const results: WriteResult[] = [];

  results.push(writeFileWithCheck('.github/workflows/release.yaml', releaseWorkflow(repoType), { dryRun, overwrite }));

  if (withConfig) {
    results.push(
      writeFileWithCheck('.config/release-kit.config.ts', releaseConfigScript(repoType), { dryRun, overwrite }),
    );
    results.push(copyCliffTemplate(dryRun, overwrite));
  }

  return results;
}
