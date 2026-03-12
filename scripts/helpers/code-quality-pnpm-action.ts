/**
 * Types and utilities for GitHub workflows using the code-quality-pnpm reusable action
 */

import { z } from 'zod';

/**
 * Schema for GitHub workflow files that use the code-quality-pnpm action
 * Only validates the structure we actually need: jobs object exists
 */
export const CodeQualityPnpmWorkflowSchema = z.looseObject({
  jobs: z.looseObject({
    'code-quality': z.looseObject({
      with: z.looseObject({
        'pnpm-version': z.string(),
      }),
    }),
  }),
});

export type CodeQualityPnpmWorkflow = z.infer<typeof CodeQualityPnpmWorkflowSchema>;

/**
 * Gets the pnpm-version from the code-quality job
 */
export function getPnpmVersion(workflow: CodeQualityPnpmWorkflow): string {
  return workflow.jobs['code-quality'].with['pnpm-version'];
}

/**
 * Updates the pnpm-version in the code-quality job
 */
export function updatePnpmVersion(workflow: CodeQualityPnpmWorkflow, newVersion: string): void {
  workflow.jobs['code-quality'].with['pnpm-version'] = newVersion;
}
