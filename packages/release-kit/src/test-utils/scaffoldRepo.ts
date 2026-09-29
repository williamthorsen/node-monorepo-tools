import { createTempTree, pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';

/** The `packages:` block that a monorepo fixture declares, which puts `discoverWorkspaces` into monorepo mode. */
export const PNPM_WORKSPACE = 'packages:\n  - packages/*\n';

/**
 * Writes a consuming repo's files to a temp tree and points `process.cwd()` at it for the rest of the test.
 *
 * A kit check that calls `discoverWorkspaces` itself is exercised against a real tree rather than a mocked workspace
 * list, so it sees what discovery actually produces, root entry included. A mocked list is free to omit the root,
 * and an `isRoot` or `isPackage` filter then passes every entry through without being exercised.
 *
 * `pointCwdAt` stubs `process.cwd()`, against which readyup's check utilities resolve every relative path, instead
 * of calling `process.chdir`, and leaves the real process state unchanged.
 */
export function scaffoldRepo(entries: Record<string, string>): void {
  const tree = disposeOnTestFinished(createTempTree(entries, { prefix: 'release-kit-repo-' }));
  disposeOnTestFinished(pointCwdAt(tree.dir));
}
