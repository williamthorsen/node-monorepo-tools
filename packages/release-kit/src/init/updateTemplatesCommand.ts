import { existsSync, readFileSync } from 'node:fs';

import {
  type ManagedFileResult,
  printError,
  printStep,
  printSuccess,
  reportTemplateUpdate,
  type StreamStyles,
  updateManagedFile,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { syncLabelsWorkflow } from '../sync-labels/templates.ts';
import { detectRepoType, type RepoType } from './detectRepoType.ts';
import { hasProvenance } from './hasProvenance.ts';
import { checkEligibility } from './initCommand.ts';
import { createGithubReleaseWorkflow, publishWorkflow, releaseWorkflow } from './templates.ts';

interface UpdateTemplatesOptions {
  dryRun: boolean;
  styles: StreamStyles;
}

const PUBLISH_WORKFLOW_PATH = '.github/workflows/publish.yaml';
const SYNC_LABELS_WORKFLOW_PATH = '.github/workflows/sync-labels.yaml';

/**
 * Runs the `release-kit update-templates` command and returns the process exit code.
 *
 * Brings each workflow that release-kit scaffolds up to date with the installed templates. The opt-in
 * `sync-labels.yaml` is refreshed only when it exists, and config files are never read or written.
 */
export function updateTemplatesCommand({ dryRun, styles }: UpdateTemplatesOptions): number {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  let eligible: boolean;
  try {
    eligible = checkEligibility(styles);
  } catch (error: unknown) {
    printError(`Eligibility check failed: ${describeError(error)}`, styles.stderr);
    return 1;
  }
  if (!eligible) return 1;

  printStep('Detecting repo type');
  let repoType: RepoType;
  try {
    repoType = detectRepoType();
  } catch (error: unknown) {
    printError(`Failed to detect repo type: ${describeError(error)}`, styles.stderr);
    return 1;
  }
  printSuccess(`Detected: ${repoType}`, styles.stdout);

  printStep('Updating workflows');
  let results: ManagedFileResult[];
  try {
    results = buildManagedFiles(repoType).map(([filePath, content]) =>
      updateManagedFile(filePath, content, { dryRun }),
    );
  } catch (error: unknown) {
    printError(`Failed to render workflows: ${describeError(error)}`, styles.stderr);
    return 1;
  }

  for (const result of results) {
    reportTemplateUpdate(result, dryRun, styles);
  }

  return results.some((result) => result.outcome === 'failed') ? 1 : 0;
}

// region | Helpers
/** Lists each managed workflow's path with the content that the installed templates render for it. */
function buildManagedFiles(repoType: RepoType): Array<[string, string]> {
  const files: Array<[string, string]> = [
    ['.github/workflows/create-github-release.yaml', createGithubReleaseWorkflow(repoType)],
    [PUBLISH_WORKFLOW_PATH, publishWorkflow(repoType, { provenance: readProvenanceSetting() })],
    ['.github/workflows/release.yaml', releaseWorkflow(repoType)],
  ];
  if (existsSync(SYNC_LABELS_WORKFLOW_PATH)) {
    files.push([SYNC_LABELS_WORKFLOW_PATH, syncLabelsWorkflow()]);
  }
  return files;
}

/** Reads whether the existing publish workflow enables provenance, defaulting to `true` when the file is missing. */
function readProvenanceSetting(): boolean {
  if (!existsSync(PUBLISH_WORKFLOW_PATH)) return true;
  return hasProvenance(readFileSync(PUBLISH_WORKFLOW_PATH, 'utf8'));
}
// endregion | Helpers
