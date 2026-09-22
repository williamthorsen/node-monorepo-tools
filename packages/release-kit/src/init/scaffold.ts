import { writeFileWithCheck, type WriteResult } from '@williamthorsen/nmr-core';

import type { RepoType } from './detectRepoType.ts';
import { createGithubReleaseWorkflow, publishWorkflow, releaseConfigScript, releaseWorkflow } from './templates.ts';

interface ScaffoldOptions {
  repoType: RepoType;
  dryRun: boolean;
  overwrite: boolean;
  withConfig: boolean;
}

/** Scaffold release-kit files for the target repo. Returns a result for each file attempted. */
export function scaffoldFiles({ repoType, dryRun, overwrite, withConfig }: ScaffoldOptions): WriteResult[] {
  const results: WriteResult[] = [
    writeFileWithCheck('.github/workflows/create-github-release.yaml', createGithubReleaseWorkflow(repoType), {
      dryRun,
      overwrite,
    }),
    writeFileWithCheck('.github/workflows/publish.yaml', publishWorkflow(repoType), { dryRun, overwrite }),
    writeFileWithCheck('.github/workflows/release.yaml', releaseWorkflow(repoType), { dryRun, overwrite }),
  ];

  if (withConfig) {
    results.push(
      writeFileWithCheck('.config/release-kit.config.ts', releaseConfigScript(repoType), { dryRun, overwrite }),
    );
  }

  return results;
}
