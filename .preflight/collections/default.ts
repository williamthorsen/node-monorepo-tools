/**
 * Sync-labels collection for repos using node-monorepo-tools label syncing.
 *
 * Run from a target repo's working directory:
 *   preflight run --file <path-to>/default.js
 */
import type { PreflightChecklist } from '@williamthorsen/preflight';
import { definePreflightCollection, fileContains, fileExists } from '@williamthorsen/preflight';

const syncLabels: PreflightChecklist = {
  name: 'sync-labels',
  checks: [
    {
      name: 'sync-labels.yaml workflow exists',
      check: () => fileExists('.github/workflows/sync-labels.yaml'),
      fix: 'Add .github/workflows/sync-labels.yaml using the sync-labels workflow template',
      checks: [
        {
          name: 'sync-labels workflow references sync-labels.reusable.yaml',
          check: () =>
            fileContains(
              '.github/workflows/sync-labels.yaml',
              /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)sync-labels\.reusable\.yaml/,
            ),
          fix: 'Update sync-labels.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@sync-labels-workflow-v1',
        },
      ],
    },
    {
      name: '.github/labels.yaml exists',
      check: () => fileExists('.github/labels.yaml'),
      fix: 'Add .github/labels.yaml with repo-specific label definitions (use release-kit sync-labels generate)',
    },
  ],
};

export default definePreflightCollection({
  checklists: [syncLabels],
});
