import { VERSION } from '../version.ts';

/** Construct the JSON Schema URL for the current version. */
function buildSchemaUrl(): string {
  return `https://github.com/williamthorsen/node-monorepo-tools/raw/audit-deps-v${VERSION}/packages/audit-deps/schemas/config.json`;
}

/** Default audit-deps config file content. */
export const auditDepsConfigTemplate =
  JSON.stringify(
    {
      $schema: buildSchemaUrl(),
      dev: {
        severityThreshold: 'moderate',
        allowlist: [],
      },
      prod: {
        severityThreshold: 'low',
        allowlist: [],
      },
    },
    null,
    2,
  ) + '\n';
