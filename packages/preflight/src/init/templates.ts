/** Starter preflight config file content. */
export const preflightConfigTemplate = `import { definePreflightConfig } from '@williamthorsen/preflight';

/** Repo-level preflight settings. */
export default definePreflightConfig({
  compile: {
    srcDir: '.preflight/distribution',
    outDir: '.preflight/distribution',
  },
});
`;

/** Starter preflight collection file content. */
export const preflightCollectionTemplate = `import { definePreflightCollection } from '@williamthorsen/preflight';

/**
 * Starter preflight collection.
 *
 * Each checklist contains checks that run before a deployment or other operation.
 * Checks run concurrently within a checklist. Use \`fix\` to provide remediation hints.
 */
export default definePreflightCollection({
  checklists: [
    {
      name: 'deploy',
      checks: [
        {
          name: 'environment variables set',
          check: () => Boolean(process.env['NODE_ENV']),
          fix: 'Set NODE_ENV before deploying',
        },
      ],
    },
  ],
});
`;
