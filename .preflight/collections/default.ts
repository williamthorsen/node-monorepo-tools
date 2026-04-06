/**
 * Drift-detection collection for convention compliance across repos.
 *
 * Run from a target repo's working directory:
 *   preflight run --file <path-to>/default.js
 */
import type { PreflightCheck, PreflightChecklist } from '@williamthorsen/preflight';
import {
  definePreflightCollection,
  fileContains,
  fileDoesNotContain,
  fileExists,
  hasPackageJsonField,
  readFile,
} from '@williamthorsen/preflight';

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

const codeQuality: PreflightChecklist = {
  name: 'code-quality',
  checks: [
    {
      name: 'code-quality.yaml workflow exists',
      check: () => fileExists('.github/workflows/code-quality.yaml'),
      fix: 'Add .github/workflows/code-quality.yaml using the code-quality workflow template',
      checks: [
        {
          name: 'code-quality workflow references @v5',
          check: () =>
            fileContains(
              '.github/workflows/code-quality.yaml',
              /uses:\s*williamthorsen\/.github\/.github\/workflows\/code-quality-pnpm-workflow\.yaml@v5/,
            ),
          fix: 'Update code-quality.yaml to reference code-quality-pnpm-workflow.yaml@v5',
          checks: [
            {
              name: 'code-quality workflow does not reference pnpm-version (requires @v5)',
              check: () =>
                !fileContains(
                  '.github/workflows/code-quality.yaml',
                  /uses:\s*williamthorsen\/.github\/.github\/workflows\/code-quality-pnpm-workflow\.yaml@v5/,
                ) || fileDoesNotContain('.github/workflows/code-quality.yaml', /pnpm-version/),
              fix: 'Remove pnpm-version from code-quality.yaml — v5 workflow infers the version from packageManager',
            },
          ],
        },
        {
          name: 'code-quality workflow does not reference GH_PACKAGES_TOKEN',
          check: () => fileDoesNotContain('.github/workflows/code-quality.yaml', /GH_PACKAGES_TOKEN/),
          fix: 'Remove all references to GH_PACKAGES_TOKEN from code-quality.yaml',
        },
      ],
    },
  ],
};

const repoSetupChecks: PreflightCheck[] = [
  {
    name: '.envrc exists',
    check: () => fileExists('.envrc'),
    fix: 'Add .envrc to repo root',
  },
  {
    name: '.config/wt.toml exists',
    check: () => fileExists('.config/wt.toml'),
    fix: 'Add .config/wt.toml for worktree configuration',
  },
  {
    name: '.editorconfig exists',
    check: () => fileExists('.editorconfig'),
    fix: 'Add .editorconfig to repo root',
  },
  {
    name: 'lefthook.yml exists',
    check: () => fileExists('lefthook.yml'),
    fix: 'Add lefthook.yml for git hook management',
  },
  {
    name: '.claude/CLAUDE.md exists',
    check: () => fileExists('.claude/CLAUDE.md'),
    fix: 'Add .claude/CLAUDE.md with project-specific agent instructions',
  },
  {
    name: '.agents/PROJECT.md exists',
    check: () => fileExists('.agents/PROJECT.md'),
    fix: 'Add .agents/PROJECT.md with project context for AI agents',
  },
  {
    name: '.agents/preferences.yaml has project.slug and project.ticket_prefix',
    check: () => preferencesHasRequiredFields(),
    fix: 'Add .agents/preferences.yaml with project.slug and project.ticket_prefix fields',
  },
  {
    name: '.audit-ci/config.dev.json5 exists',
    check: () => fileExists('.audit-ci/config.dev.json5'),
    fix: 'Add .audit-ci/config.dev.json5 for dev dependency audit configuration',
  },
  {
    name: '.audit-ci/config.prod.json5 exists',
    check: () => fileExists('.audit-ci/config.prod.json5'),
    fix: 'Add .audit-ci/config.prod.json5 for prod dependency audit configuration',
  },
  {
    name: 'package.json has "type": "module"',
    check: () => hasPackageJsonField('type', 'module'),
    fix: 'Add "type": "module" to package.json',
  },
  {
    name: 'package.json has packageManager field',
    check: () => hasPackageJsonField('packageManager'),
    fix: 'Add "packageManager" field to package.json (e.g., "pnpm@10.33.0")',
  },
  {
    name: '.tool-versions does not contain pnpm',
    check: () => toolVersionsHasNoPnpm(),
    fix: 'Remove pnpm from .tool-versions — manage via packageManager field and corepack',
  },
];

const repoSetup: PreflightChecklist = {
  name: 'repo-setup',
  checks: repoSetupChecks,
};

export default definePreflightCollection({
  checklists: [syncLabels, codeQuality, repoSetup],
});

// -- Collection-specific helpers ----------------------------------------------

/** Verify that .agents/preferences.yaml contains project.slug and project.ticket_prefix. */
function preferencesHasRequiredFields(): boolean {
  const content = readFile('.agents/preferences.yaml');
  if (content === undefined) return false;
  const hasSlug = /^\s+slug:\s*\S/m.test(content);
  const hasTicketPrefix = /^\s+ticket_prefix:\s*\S/m.test(content);
  return hasSlug && hasTicketPrefix;
}

/** Check that .tool-versions does not list pnpm. Pass if the file is absent. */
function toolVersionsHasNoPnpm(): boolean {
  const content = readFile('.tool-versions');
  if (content === undefined) return true;
  return !/^pnpm\s/m.test(content);
}
