import { describe, expect, it } from 'vitest';

import { PNPM_WORKSPACE, scaffoldRepo } from '../../test-utils/scaffoldRepo.ts';
import { formatPrivateWorkflowSkip, hasPublishablePackage } from '../hasPublishablePackage.ts';

describe(hasPublishablePackage, () => {
  it('returns false for a single-package repo whose package is private', () => {
    scaffoldRepo({ 'package.json': '{"name":"site","private":true}' });

    expect(hasPublishablePackage()).toBe(false);
  });

  it('returns true for a single-package repo whose package is public', () => {
    scaffoldRepo({ 'package.json': '{"name":"lib"}' });

    expect(hasPublishablePackage()).toBe(true);
  });

  it('returns false for a monorepo whose packages are all private', () => {
    scaffoldRepo({
      'package.json': '{"name":"root","private":true}',
      'pnpm-workspace.yaml': PNPM_WORKSPACE,
      'packages/a/package.json': '{"name":"a","private":true}',
      'packages/b/package.json': '{"name":"b","private":true}',
    });

    expect(hasPublishablePackage()).toBe(false);
  });

  it('returns true for a monorepo with one public package', () => {
    scaffoldRepo({
      'package.json': '{"name":"root","private":true}',
      'pnpm-workspace.yaml': PNPM_WORKSPACE,
      'packages/a/package.json': '{"name":"a","private":true}',
      'packages/b/package.json': '{"name":"b"}',
    });

    expect(hasPublishablePackage()).toBe(true);
  });

  it('reads a private package that does not declare a name', () => {
    scaffoldRepo({ 'package.json': '{"private":true}' });

    expect(hasPublishablePackage()).toBe(false);
  });

  it('treats a truthy non-boolean `private` as private', () => {
    scaffoldRepo({ 'package.json': '{"name":"site","private":"true"}' });

    expect(hasPublishablePackage()).toBe(false);
  });

  it('returns true when a manifest cannot be parsed', () => {
    scaffoldRepo({
      'package.json': '{"name":"root","private":true}',
      'pnpm-workspace.yaml': PNPM_WORKSPACE,
      'packages/a/package.json': '{ not json',
    });

    expect(hasPublishablePackage()).toBe(true);
  });

  it('returns true when the workspace resolves to nothing', () => {
    scaffoldRepo({
      'package.json': '{"name":"root","private":true}',
      'pnpm-workspace.yaml': PNPM_WORKSPACE,
    });

    expect(hasPublishablePackage()).toBe(true);
  });
});

describe(formatPrivateWorkflowSkip, () => {
  it('names the skipped file and the reason', () => {
    expect(formatPrivateWorkflowSkip('.github/workflows/publish.yaml')).toBe(
      'Skipping .github/workflows/publish.yaml: every package is private',
    );
  });
});
