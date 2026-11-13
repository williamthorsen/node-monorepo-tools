import { existsSync, readFileSync } from 'node:fs';

import type { RepoType } from './detectRepoType.ts';
import { hasProvenance } from './hasProvenance.ts';
import { PUBLISH_WORKFLOW_PATH } from './scaffold.ts';
import { renderCreateGithubReleaseWorkflow, renderPublishWorkflow, renderReleaseWorkflow } from './templates.ts';

/** Renders the create-github-release workflow that the repo should contain. */
export function renderExpectedCreateGithubReleaseWorkflow(repoType: RepoType): string {
  return renderCreateGithubReleaseWorkflow(repoType);
}

/**
 * Renders the publish workflow that the repo should contain, keeping the provenance setting of the existing
 * `publish.yaml` and enabling provenance when the file is missing.
 */
export function renderExpectedPublishWorkflow(repoType: RepoType): string {
  return renderPublishWorkflow(repoType, { shouldGenerateProvenance: readProvenanceSetting() });
}

/** Renders the release workflow that the repo should contain. */
export function renderExpectedReleaseWorkflow(repoType: RepoType): string {
  return renderReleaseWorkflow(repoType);
}

// region | Helpers
/** Reads whether the existing publish workflow enables provenance, defaulting to `true` when the file is missing. */
function readProvenanceSetting(): boolean {
  if (!existsSync(PUBLISH_WORKFLOW_PATH)) return true;
  return hasProvenance(readFileSync(PUBLISH_WORKFLOW_PATH, 'utf8'));
}
// endregion | Helpers
