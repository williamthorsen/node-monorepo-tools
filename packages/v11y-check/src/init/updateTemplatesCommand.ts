import {
  type ManagedFileResult,
  printStep,
  reportTemplateUpdate,
  type StreamStyles,
  updateManagedFile,
} from '@williamthorsen/nmr-core';

import { readWorkflowTemplate, WORKFLOW_PATH } from './scaffold.ts';

interface UpdateTemplatesOptions {
  dryRun: boolean;
  styles: StreamStyles;
}

/**
 * Runs the `v11y update-templates` command and returns the process exit code.
 *
 * Brings the scaffolded audit workflow up to date with the bundled template; the config file is never read or written.
 */
export function updateTemplatesCommand({ dryRun, styles }: UpdateTemplatesOptions): number {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  printStep('Updating workflows');
  const template = readWorkflowTemplate();
  const result: ManagedFileResult =
    'error' in template
      ? { filePath: WORKFLOW_PATH, outcome: 'failed', error: template.error }
      : updateManagedFile(WORKFLOW_PATH, template.content, { dryRun });
  reportTemplateUpdate(result, dryRun, styles);

  return result.outcome === 'failed' ? 1 : 0;
}
