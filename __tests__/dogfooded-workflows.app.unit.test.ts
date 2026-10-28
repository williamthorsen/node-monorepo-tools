import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  renderCreateGithubReleaseWorkflow,
  renderPublishWorkflow,
  renderReleaseWorkflow,
} from '../packages/release-kit/src/init/templates.ts';

const repoRoot = join(import.meta.dirname, '..');
const workflowsDir = join(repoRoot, '.github', 'workflows');

/**
 * This repo dogfoods the workflow templates that its own packages scaffold, so each caller workflow here must be the
 * template's output verbatim -- the same identity that the kits enforce in consumer repos.
 */
describe('repo workflows match the templates that its packages publish', () => {
  it('create-github-release.yaml matches release-kit renderCreateGithubReleaseWorkflow("monorepo")', () => {
    const content = readFileSync(join(workflowsDir, 'create-github-release.yaml'), 'utf8');

    expect(
      content,
      'Run `release-kit update-templates` to regenerate .github/workflows/create-github-release.yaml',
    ).toBe(renderCreateGithubReleaseWorkflow('monorepo'));
  });

  it('publish.yaml matches release-kit renderPublishWorkflow("monorepo")', () => {
    const content = readFileSync(join(workflowsDir, 'publish.yaml'), 'utf8');

    expect(content, 'Run `release-kit update-templates` to regenerate .github/workflows/publish.yaml').toBe(
      renderPublishWorkflow('monorepo'),
    );
  });

  it('release.yaml matches release-kit renderReleaseWorkflow("monorepo")', () => {
    const content = readFileSync(join(workflowsDir, 'release.yaml'), 'utf8');

    expect(content, 'Run `release-kit update-templates` to regenerate .github/workflows/release.yaml').toBe(
      renderReleaseWorkflow('monorepo'),
    );
  });

  it('sync-labels.yaml matches the release-kit sync-labels template', () => {
    const content = readFileSync(join(workflowsDir, 'sync-labels.yaml'), 'utf8');
    const template = readFileSync(
      join(repoRoot, 'packages', 'release-kit', 'templates', 'sync-labels.yaml.template'),
      'utf8',
    );

    expect(content, 'Run `release-kit update-templates` to regenerate .github/workflows/sync-labels.yaml').toBe(
      template,
    );
  });

  it('audit.yaml matches the v11y-check audit template', () => {
    const content = readFileSync(join(workflowsDir, 'audit.yaml'), 'utf8');
    const template = readFileSync(join(repoRoot, 'packages', 'v11y-check', 'templates', 'audit.yaml.template'), 'utf8');

    expect(content, 'Run `v11y update-templates` to regenerate .github/workflows/audit.yaml').toBe(template);
  });
});
