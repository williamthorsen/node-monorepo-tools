/**
 * Readyup kit for consumers of @williamthorsen/audit-deps.
 *
 * Verifies that the consuming repo's audit-deps setup is current and correctly
 * configured. The minimum version is read from the audit-deps package's
 * package.json and inlined by esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   rdy run --file <path-to>/audit-deps.js
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineRdyKit, fileExists, fileMatchesHash, hasDevDependency, hasMinDevDependencyVersion } from 'readyup';

import auditDepsPackageJson from '../../packages/audit-deps/package.json' with { type: 'json' };

const MIN_VERSION = auditDepsPackageJson.version;

// SHA-256 hash of the canonical .github/workflows/audit.yaml wrapper.
// Keep in sync — verified by __tests__/rdy-kit-hashes.app.test.ts.
export const AUDIT_WORKFLOW_HASH = '1b656bf31d7d4d5275a6db16ad1efcc71ff1cb08bf7025dc26fbeccf4485c884';

export default defineRdyKit({
  checklists: [
    {
      name: 'audit-deps',
      checks: [
        // -- Setup ---------------------------------------------------------------
        {
          name: '@williamthorsen/audit-deps in devDependencies',
          severity: 'error',
          check: () => hasDevDependency('@williamthorsen/audit-deps'),
          fix: 'pnpm add --save-dev @williamthorsen/audit-deps',
          checks: [
            {
              name: `@williamthorsen/audit-deps >= ${MIN_VERSION}`,
              severity: 'error',
              check: () =>
                hasMinDevDependencyVersion('@williamthorsen/audit-deps', MIN_VERSION, {
                  exempt: (range) => range.startsWith('workspace:'),
                }),
              fix: `pnpm add --save-dev @williamthorsen/audit-deps@^${MIN_VERSION}`,
            },
          ],
        },

        // -- Config existence ----------------------------------------------------
        {
          name: '.config/audit-deps.config.json exists',
          severity: 'warn',
          check: auditDepsConfigExists,
          fix: 'Create .config/audit-deps.config.json with audit-deps configuration',
        },

        // -- Audit-ci config migration -------------------------------------------
        {
          name: 'audit-ci configs are under .config/audit-ci/',
          severity: 'warn',
          skip: skipLegacyAuditCiCheck,
          check: noLegacyAuditCiDirectory,
          fix: 'Move audit-ci configs from .audit-ci/ to .config/audit-ci/ and update references',
        },

        // -- Audit workflow ------------------------------------------------------
        {
          name: 'audit.yaml workflow exists',
          severity: 'warn',
          check: () => fileExists('.github/workflows/audit.yaml'),
          fix: 'Add .github/workflows/audit.yaml using the audit workflow template',
          checks: [
            {
              name: 'audit.yaml matches template',
              severity: 'warn',
              check: () => fileMatchesHash('.github/workflows/audit.yaml', AUDIT_WORKFLOW_HASH),
              fix: 'Replace .github/workflows/audit.yaml with the current template at williamthorsen/node-monorepo-tools:.github/workflows/audit.yaml',
            },
          ],
        },
      ],
    },
  ],
});

// -- Helpers -----------------------------------------------------------------

/** Check that `.config/audit-deps.config.json` exists. */
export function auditDepsConfigExists(): boolean {
  return fileExists('.config/audit-deps.config.json');
}

/** Skip the legacy audit-ci check when there is no `.audit-ci/` directory. */
export function skipLegacyAuditCiCheck(): string | false {
  return !existsSync(join(process.cwd(), '.audit-ci')) ? 'no legacy .audit-ci/ directory' : false;
}

/** Check that no legacy `.audit-ci/` directory exists. */
export function noLegacyAuditCiDirectory(): boolean {
  return !existsSync(join(process.cwd(), '.audit-ci'));
}
