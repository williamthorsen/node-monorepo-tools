import { writeFileWithCheck, type WriteResult } from '@williamthorsen/nmr-core';

import type { RepoType } from './detectRepoType.ts';
import { createGithubReleaseWorkflow, publishWorkflow, releaseConfigScript, releaseWorkflow } from './templates.ts';

interface ScaffoldOptions {
  repoType: RepoType;
  isDryRun: boolean;
  shouldOverwrite: boolean;
  publishable: boolean;
  shouldScaffoldConfig: boolean;
}

export const CREATE_GITHUB_RELEASE_WORKFLOW_PATH = '.github/workflows/create-github-release.yaml';
export const PUBLISH_WORKFLOW_PATH = '.github/workflows/publish.yaml';

/** The workflows that act only on publishable packages, which a repo whose packages are all private does not get. */
export const PUBLISHING_WORKFLOW_PATHS = [CREATE_GITHUB_RELEASE_WORKFLOW_PATH, PUBLISH_WORKFLOW_PATH] as const;

/** Scaffolds release-kit files for the target repo, returning a result for each file attempted. */
export function scaffoldFiles({
  repoType,
  isDryRun,
  shouldOverwrite,
  publishable,
  shouldScaffoldConfig,
}: ScaffoldOptions): WriteResult[] {
  const results: WriteResult[] = [];

  if (publishable) {
    results.push(
      writeFileWithCheck(CREATE_GITHUB_RELEASE_WORKFLOW_PATH, createGithubReleaseWorkflow(repoType), {
        isDryRun,
        shouldOverwrite,
      }),
      writeFileWithCheck(PUBLISH_WORKFLOW_PATH, publishWorkflow(repoType), {
        isDryRun,
        shouldOverwrite,
      }),
    );
  }

  results.push(
    writeFileWithCheck('.github/workflows/release.yaml', releaseWorkflow(repoType), {
      isDryRun,
      shouldOverwrite,
    }),
  );

  if (shouldScaffoldConfig) {
    results.push(
      writeFileWithCheck('.config/release-kit.config.ts', releaseConfigScript(repoType), {
        isDryRun,
        shouldOverwrite,
      }),
    );
  }

  return results;
}
