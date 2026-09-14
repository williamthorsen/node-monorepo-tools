import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createGithubReleaseWorkflow,
  publishWorkflow,
  releaseWorkflow,
} from '../packages/release-kit/src/init/templates.ts';
import { syncLabelsWorkflow } from '../packages/release-kit/src/sync-labels/templates.ts';

const repoRoot = join(import.meta.dirname, '..');
const workflowsDir = join(repoRoot, '.github', 'workflows');

/**
 * This repo dogfoods the workflow templates its own packages scaffold, so each caller workflow here must be the
 * template's output verbatim -- the same identity the kits enforce in consumer repos.
 */
describe('repo workflows match the templates its packages ship', () => {
  it('create-github-release.yaml matches release-kit createGithubReleaseWorkflow("monorepo")', () => {
    const content = readFileSync(join(workflowsDir, 'create-github-release.yaml'), 'utf8');

    expect(content, 'Run `release-kit init --force` to regenerate .github/workflows/create-github-release.yaml').toBe(
      createGithubReleaseWorkflow('monorepo'),
    );
  });

  it('publish.yaml matches release-kit publishWorkflow("monorepo")', () => {
    const content = readFileSync(join(workflowsDir, 'publish.yaml'), 'utf8');

    expect(content, 'Run `release-kit init --force` to regenerate .github/workflows/publish.yaml').toBe(
      publishWorkflow('monorepo'),
    );
  });

  it('release.yaml matches release-kit releaseWorkflow("monorepo")', () => {
    const content = readFileSync(join(workflowsDir, 'release.yaml'), 'utf8');

    expect(content, 'Run `release-kit init --force` to regenerate .github/workflows/release.yaml').toBe(
      releaseWorkflow('monorepo'),
    );
  });

  it('sync-labels.yaml matches release-kit syncLabelsWorkflow()', () => {
    const content = readFileSync(join(workflowsDir, 'sync-labels.yaml'), 'utf8');

    expect(content, 'Run `release-kit sync-labels init --force` to regenerate .github/workflows/sync-labels.yaml').toBe(
      syncLabelsWorkflow(),
    );
  });

  it('audit.yaml matches the v11y-check audit template', () => {
    const content = readFileSync(join(workflowsDir, 'audit.yaml'), 'utf8');
    const template = readFileSync(join(repoRoot, 'packages', 'v11y-check', 'templates', 'audit.yaml.template'), 'utf8');

    expect(content, 'Run `v11y init --force` to regenerate .github/workflows/audit.yaml').toBe(template);
  });
});
