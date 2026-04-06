/**
 * Demo collection showcasing preflight features.
 *
 * Exercises nested checks, N/A suppression, staged groups with halt-on-failure,
 * preconditions, mixed severities, and fix messages — all against real files in
 * this repo.
 *
 * Run from the repo root:
 *   preflight run --file .preflight/collections/demo.js
 */
import type { PreflightChecklist, PreflightStagedChecklist } from '@williamthorsen/preflight';
import {
  definePreflightCollection,
  fileContains,
  fileExists,
  hasDevDependency,
  hasPackageJsonField,
} from '@williamthorsen/preflight';

// -- Flat checklist with preconditions and nested checks ----------------------
// Demonstrates: precondition gating, passing hierarchy with indentation.

const projectFoundations: PreflightChecklist = {
  name: 'project-foundations',
  preconditions: [
    {
      name: 'package.json exists',
      check: () => fileExists('package.json'),
    },
  ],
  checks: [
    {
      name: 'ESM project ("type": "module")',
      check: () => hasPackageJsonField('type', 'module'),
      fix: 'Add "type": "module" to package.json',
    },
    {
      name: 'packageManager field is set',
      check: () => hasPackageJsonField('packageManager'),
      fix: 'Add "packageManager" to package.json (e.g., "pnpm@10.x.x")',
    },
    {
      name: 'pnpm-workspace.yaml exists',
      check: () => fileExists('pnpm-workspace.yaml'),
      fix: 'Create pnpm-workspace.yaml with workspace package globs',
      checks: [
        {
          name: 'workspace includes packages/*',
          check: () => fileContains('pnpm-workspace.yaml', /packages\/\*/),
        },
      ],
    },
    {
      name: '.editorconfig exists',
      check: () => fileExists('.editorconfig'),
      fix: 'Add .editorconfig to repo root',
    },
  ],
};

// -- Flat checklist with nested checks and intentional failure ----------------
// Demonstrates: failed parent (🟠) with skipped children (⛔), passing
// hierarchy, and mixed severities.

const ciWorkflows: PreflightChecklist = {
  name: 'ci-workflows',
  checks: [
    {
      name: 'code-quality.yaml workflow exists',
      check: () => fileExists('.github/workflows/code-quality.yaml'),
      checks: [
        {
          name: 'references reusable workflow',
          check: () =>
            fileContains(
              '.github/workflows/code-quality.yaml',
              /uses:\s*williamthorsen\/.github\/.github\/workflows\/code-quality-pnpm-workflow\.yaml/,
            ),
        },
      ],
    },
    {
      name: 'deploy-preview.yaml workflow exists',
      severity: 'warn',
      check: () => fileExists('.github/workflows/deploy-preview.yaml'),
      fix: 'Add .github/workflows/deploy-preview.yaml for PR preview deployments',
      checks: [
        {
          name: 'references staging environment',
          severity: 'warn',
          check: () => fileContains('.github/workflows/deploy-preview.yaml', /environment:\s*staging/),
        },
        {
          name: 'pins runner to ubuntu-latest',
          severity: 'warn',
          check: () => fileContains('.github/workflows/deploy-preview.yaml', /runs-on:\s*ubuntu-latest/),
        },
      ],
    },
  ],
};

// -- Flat checklist with skip conditions (N/A suppression) --------------------
// Demonstrates: N/A subtrees are invisible — Docker and Renovate sections
// vanish entirely because the parent's skip returns a reason string. Only
// Lefthook (which exists) appears in output.

const optionalIntegrations: PreflightChecklist = {
  name: 'optional-integrations',
  checks: [
    {
      name: 'Docker',
      skip: () => (!fileExists('Dockerfile') ? 'no Dockerfile' : false),
      check: () => true,
      checks: [
        {
          name: 'docker-compose.yaml exists',
          check: () => fileExists('docker-compose.yaml'),
        },
      ],
    },
    {
      name: 'Renovate',
      skip: () => (!fileExists('renovate.json') ? 'no renovate.json' : false),
      check: () => true,
      checks: [
        {
          name: 'extends recommended preset',
          check: () => fileContains('renovate.json', /extends.*config:recommended/),
        },
      ],
    },
    {
      name: 'lefthook in devDependencies',
      check: () => hasDevDependency('lefthook'),
      fix: 'pnpm add --save-dev lefthook',
      checks: [
        {
          name: 'lefthook.yml exists',
          check: () => fileExists('lefthook.yml'),
          fix: 'Add lefthook.yml for git hook management',
          checks: [
            {
              name: 'pre-commit hook configured',
              check: () => fileContains('lefthook.yml', /pre-commit:/),
              fix: 'Add a pre-commit section to lefthook.yml',
              checks: [
                {
                  name: 'linter runs on pre-commit',
                  severity: 'recommend',
                  check: () => fileContains('lefthook.yml', /eslint|lint/),
                  fix: 'Add an ESLint command to the pre-commit hook',
                },
                {
                  name: 'unknown files are ignored',
                  check: () => fileContains('lefthook.yml', /--ignore-unknown/),
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// -- Staged checklist with halt-on-failure ------------------------------------
// Demonstrates: groups run sequentially. A failure in group 2 (missing LICENSE)
// halts group 3 — its checks appear as ⛔ skipped.

const releaseReadiness: PreflightStagedChecklist = {
  name: 'release-readiness',
  groups: [
    // Group 1: repository metadata (all pass)
    [
      {
        name: 'package.json has "repository" field',
        check: () => hasPackageJsonField('repository'),
        fix: 'Add "repository" to package.json',
      },
      {
        name: 'package.json has "homepage" field',
        check: () => hasPackageJsonField('homepage'),
        fix: 'Add "homepage" to package.json',
      },
    ],
    // Group 2: open-source readiness (LICENSE fails → halts group 3)
    [
      {
        name: 'CHANGELOG.md exists',
        check: () => fileExists('CHANGELOG.md'),
      },
      {
        name: 'LICENSE file exists',
        check: () => fileExists('LICENSE') || fileExists('LICENSE.md'),
        fix: 'Add a LICENSE file to the repo root',
      },
    ],
    // Group 3: publishing automation (skipped because group 2 failed)
    [
      {
        name: 'release workflow exists',
        check: () => fileExists('.github/workflows/release.yaml'),
      },
      {
        name: 'publish workflow exists',
        check: () => fileExists('.github/workflows/publish.yaml'),
      },
      {
        name: 'git-cliff not in devDependencies',
        severity: 'recommend',
        check: () => !hasDevDependency('git-cliff'),
        fix: 'pnpm remove git-cliff — release-kit handles changelog generation',
      },
    ],
  ],
  fixLocation: 'inline',
};

export default definePreflightCollection({
  checklists: [projectFoundations, ciWorkflows, optionalIntegrations, releaseReadiness],
});
