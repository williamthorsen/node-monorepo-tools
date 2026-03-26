/** Starter preflight config file content. */
export const preflightConfigTemplate = `import { definePreflightConfig } from '@williamthorsen/preflight';

/**
 * Preflight configuration.
 *
 * Each checklist contains checks that run before a deployment or other operation.
 * Checks run concurrently within a checklist. Use \`fix\` to provide remediation hints.
 */
export default definePreflightConfig({
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
