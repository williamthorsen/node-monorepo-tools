import { resolveSelfVersion } from '@williamthorsen/nmr-core';

const VERSION = resolveSelfVersion(import.meta.url);

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

// region | Helpers

/** Constructs the JSON Schema URL for the current version. */
function buildSchemaUrl(): string {
  return `https://github.com/williamthorsen/node-monorepo-tools/raw/v11y-check-v${VERSION}/packages/v11y-check/schemas/config.json`;
}

// endregion | Helpers
