import { readPackageVersion } from '@williamthorsen/nmr-core';

const VERSION = readPackageVersion(import.meta.url);

/** Construct the JSON Schema URL for the current version. */
function buildSchemaUrl(): string {
  return `https://github.com/williamthorsen/node-monorepo-tools/raw/v11y-check-v${VERSION}/packages/v11y-check/schemas/config.json`;
}

/** Default v11y-check config file content. */
export const v11yCheckConfigTemplate =
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
