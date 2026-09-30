/**
 * Readyup kit for consumers of v11y-check.
 *
 * Verifies that the consuming repo's v11y-check setup is current and correctly configured.
 *
 * Run from a target repo's working directory:
 *   rdy run --from npm:v11y-check
 *
 * A check asserting the absence of something declares `quiet`: A conformant repo is already in the passing
 * state, so only a failure is worth reporting.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineRdyKit, pickJson } from 'readyup';
import { fileExists, fileMatchesHash, hasDevDependency, hasMinDevDependencyVersion } from 'readyup/check-utils';

// SHA-256 of `templates/audit.yaml.template`; `src/__tests__/kit-hashes.unit.test.ts` fails when the two differ.
export const AUDIT_WORKFLOW_HASH = 'ad969e3fefe603cee04de02e300e6f4d4d9dae9e8e58bddb9db81980115bc260';

export default defineRdyKit({
  checklists: [
    {
      name: 'v11y-check',
      checks: [
        // -- Setup --
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

        // -- Audit-ci config migration --
        {
          name: 'audit-ci configs are under .config/audit-ci/',
          severity: 'warn',
          quiet: true,
          check: noLegacyAuditCiDirectory,
          fix: 'Move audit-ci configs from .audit-ci/ to .config/audit-ci/ and update references',
        },

        // -- Audit workflow --
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
              fix: 'Run `v11y init --force` to regenerate audit.yaml from the current template',
            },
          ],
        },
      ],
    },
  ],
});

// region | Helpers

/** Returns the minimum v11y-check version that the kit requires: this package's own version. */
function getMinVersion(): string {
  // `pickJson` is a compile-time helper: `rdy compile` rewrites the call to inline only the listed fields.
  // Defer the call into a function so that module load does not invoke the runtime stub (which throws):
  // This keeps the module importable in tests that bypass the compile step.
  const picked = pickJson('../../package.json', ['version']);
  if (typeof picked['version'] !== 'string') {
    throw new TypeError("v11y-check/package.json: 'version' must be a string");
  }
  return picked['version'];
}

/** Checks that the working directory does not contain a legacy `.audit-ci/` directory. */
export function noLegacyAuditCiDirectory(): boolean {
  return !existsSync(join(process.cwd(), '.audit-ci'));
}

// endregion | Helpers
