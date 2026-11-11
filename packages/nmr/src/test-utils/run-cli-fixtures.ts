import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { it as baseIt } from 'vitest';

import { createRunCliHarness } from './run-cli-harness.ts';

/** Creates a temporary pnpm workspace that contains one package, `my-pkg`. */
export function createWorkspaceTree(): TempTree {
  return createTempTree(
    { 'packages/my-pkg/package.json': '{"name":"my-pkg"}', 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n' },
    { prefix: 'nmr-runcli-' },
  );
}

/** Provides each test with a workspace `tree` and an `nmr` harness whose fakes start fresh. */
export const it = baseIt
  .extend(
    'tree',
    makeFixture(() => createWorkspaceTree()),
  )
  .extend('nmr', () => createRunCliHarness());
