/**
 * Readyup kit for consumers of v11y-check.
 *
 * Verifies that the consuming repo's v11y-check setup is current and correctly
 * configured. The minimum version is read from the v11y-check package's
 * package.json and inlined by esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   rdy run --file <path-to>/v11y-check.js
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineRdyKit, pickJson } from 'readyup';
import { fileExists, fileMatchesHash, hasDevDependency, hasMinDevDependencyVersion } from 'readyup/check-utils';

// `pickJson` is a compile-time helper: `rdy compile` rewrites the call to inline
// only the listed fields. The runtime stub throws, so defer the call into a
// function — this keeps the module importable in tests that don't go through
// the readyup compile step.
function getMinVersion(): string {
  const picked = pickJson('../../packages/v11y-check/package.json', ['version']);
  if (typeof picked.version !== 'string') {
    throw new TypeError("v11y-check/package.json: 'version' must be a string");
  }
  return picked.version;
}

// SHA-256 hash of the canonical .github/workflows/audit.yaml wrapper.
// Keep in sync — verified by __tests__/rdy-kit-hashes.app.test.ts.
export const AUDIT_WORKFLOW_HASH = 'cdcab39d794ed7ec5ea45e8f3c887eb5d15edb63eab65e515714556933d9b03f';

export default defineRdyKit({
  checklists: [
    {
      name: 'v11y-check',
      checks: [
        // -- Setup ---------------------------------------------------------------
        {
          name: 'v11y-check in devDependencies',
          severity: 'error',
          check: () => hasDevDependency('v11y-check'),
          fix: 'pnpm add --save-dev v11y-check',
          checks: [
            {
              get name() {
                return `v11y-check >= ${getMinVersion()}`;
              },
              severity: 'error',
              check: () =>
                hasMinDevDependencyVersion('v11y-check', getMinVersion(), {
                  exempt: (range) => range.startsWith('workspace:'),
                }),
              get fix() {
                return `pnpm add --save-dev v11y-check@^${getMinVersion()}`;
              },
            },
          ],
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

/** Skip the legacy audit-ci check when there is no `.audit-ci/` directory. */
export function skipLegacyAuditCiCheck(): string | false {
  return !existsSync(join(process.cwd(), '.audit-ci')) ? 'no legacy .audit-ci/ directory' : false;
}

/** Check that no legacy `.audit-ci/` directory exists. */
export function noLegacyAuditCiDirectory(): boolean {
  return !existsSync(join(process.cwd(), '.audit-ci'));
}
