import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';

/** Creates a temporary pnpm workspace that contains one package, `my-pkg`. */
export function createWorkspaceTree(): TempTree {
  return createTempTree(
    { 'packages/my-pkg/package.json': '{"name":"my-pkg"}', 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n' },
    { prefix: 'nmr-runcli-' },
  );
}
