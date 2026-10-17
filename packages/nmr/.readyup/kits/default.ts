/**
 * Readyup kit for consumers of @williamthorsen/nmr.
 *
 * Verifies that the consuming repo's nmr setup is current and correctly configured.
 * The minimum version is read from the nmr package's package.json and inlined by esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   rdy run --from npm:@williamthorsen/nmr
 *
 * A check asserting the absence of something declares `quiet`: A conformant repo is already in the passing
 * state, so only a failure is worth a line.
 */
import { defineRdyKit } from 'readyup';
import { hasDevDependency } from 'readyup/check-utils';

import { binTargetChecks } from '../lib/bin-targets.ts';
import { gitHookChecks, legacyRunnerChecks, rootScriptChecks } from '../lib/root-scripts.ts';
import { selfHostedRunnerChecklist } from '../lib/self-hosted-runner.ts';
import { setupChecks } from '../lib/setup.ts';
import { prettierChecks, tazeChecks } from '../lib/shared-configs.ts';
import { vitestChecks } from '../lib/vitest.ts';
import { buildReadinessChecks } from '../lib/workspace-build.ts';

export default defineRdyKit({
  checklists: [
    {
      name: 'nmr',
      checks: [
        // -- Setup --
        ...setupChecks,
        // -- Root script cleanup --
        ...rootScriptChecks,
        // -- Git hooks --
        ...gitHookChecks,
        // -- Workspace build readiness --
        ...buildReadinessChecks,
        // -- Bin targets --
        ...binTargetChecks,
        // -- Vitest projects --
        ...vitestChecks,
        // -- Shared Prettier config --
        ...prettierChecks,
        // -- Shared upgrade policy --
        ...tazeChecks,
        // -- Audit dependency --
        {
          name: 'v11y-check in devDependencies',
          severity: 'warn',
          check: () => hasDevDependency('v11y-check'),
          fix: 'pnpm add --save-dev v11y-check',
        },
        // -- Legacy script runner --
        ...legacyRunnerChecks,
      ],
    },
    selfHostedRunnerChecklist,
  ],
});
