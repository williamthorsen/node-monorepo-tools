import { type Document, isScalar, type Scalar, visit } from 'yaml';
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

/**
 * Collects every `pnpm-version` scalar value node in the workflow document, across all jobs.
 * Returns the live nodes so callers can update them in place, preserving comments and quote style.
 */
export function getPnpmVersionNodes(doc: Document): Scalar[] {
  const nodes: Scalar[] = [];
  visit(doc, {
    Pair(_, pair) {
      if (isScalar(pair.key) && pair.key.value === 'pnpm-version' && isScalar(pair.value)) {
        nodes.push(pair.value);
      }
    },
  });
  return nodes;
}
