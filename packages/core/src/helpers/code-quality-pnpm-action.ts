import { z } from 'zod';

/**
 * Schema for GitHub workflow files that use the code-quality-pnpm action.
 * Only validates the structure we need: jobs.code-quality.with.pnpm-version.
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

export function getPnpmVersion(workflow: CodeQualityPnpmWorkflow): string {
  return workflow.jobs['code-quality'].with['pnpm-version'];
}
