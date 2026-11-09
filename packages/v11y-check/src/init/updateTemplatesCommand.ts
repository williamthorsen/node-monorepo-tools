import {
  type ManagedFileResult,
  printStep,
  reportTemplateUpdate,
  type StreamStyles,
  updateManagedFile,
} from '@williamthorsen/nmr-core';

import { readWorkflowTemplate, WORKFLOW_PATH } from './scaffold.ts';

interface UpdateTemplatesOptions {
  isDryRun: boolean;
  styles: StreamStyles;
}

/**
 * Runs the `v11y update-templates` command and returns the process exit code.
 *
 * Brings the scaffolded audit workflow up to date with the bundled template; the config file is never read or written.
 */
export function updateTemplatesCommand(
  { isDryRun, styles }: UpdateTemplatesOptions,
  dependencies: UpdateTemplatesDependencies = defaultUpdateTemplatesDependencies,
): number {
  if (isDryRun) {
    console.info('[dry-run mode]');
  }

  printStep('Updating workflows');
  const template = dependencies.readWorkflowTemplate();
  const result: ManagedFileResult =
    'error' in template
      ? { filePath: WORKFLOW_PATH, outcome: 'failed', error: template.error }
      : updateManagedFile(WORKFLOW_PATH, template.content, { isDryRun });
  reportTemplateUpdate(result, isDryRun, styles);

  return result.outcome === 'failed' ? 1 : 0;
}

/** Functions through which `updateTemplatesCommand` reads the bundled workflow template. */
export interface UpdateTemplatesDependencies {
  readWorkflowTemplate: typeof readWorkflowTemplate;
}

/** The real implementations of the `updateTemplatesCommand` dependencies. */
export const defaultUpdateTemplatesDependencies: UpdateTemplatesDependencies = { readWorkflowTemplate };
