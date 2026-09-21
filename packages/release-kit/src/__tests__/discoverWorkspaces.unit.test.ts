import { createTempTree, pointCwdAt, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { describeEmptyWorkspace, discoverWorkspaces } from '../discoverWorkspaces.ts';
import { emptyWorkspace } from '../test-utils/workspaceResolutions.ts';

const PREFIX = 'release-kit-discover-workspaces-';

describe(discoverWorkspaces, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(
      createTempTree(
        {
          'packages/alpha/package.json': '{"name":"@scope/alpha"}',
          'packages/legacy/package.json': '{"name":"legacy"}',
        },
        { prefix: PREFIX },
      ),
    );
  });

  it('reports single-package where the root holds no pnpm-workspace.yaml', () => {
    expect(discoverWorkspaces(tree.dir)).toStrictEqual({ kind: 'single-package' });
  });

  // pnpm resolves such a manifest to the root package alone, and a workspace file kept for `catalog:` or
  // `overrides:` alone is an ordinary single-package repo rather than one whose manifest needs repairing.
  it.each([
    ['the file is empty', ''],
    ['the `packages` key is absent', 'catalog:\n  zod: 4.1.13\n'],
    ['the `packages` key is null', 'packages:\n'],
    ['the `packages` list is empty', 'packages: []\n'],
  ])('reports single-package where %s', (_condition, manifest) => {
    tree.write('pnpm-workspace.yaml', manifest);

    expect(discoverWorkspaces(tree.dir)).toStrictEqual({ kind: 'single-package' });
  });

  // Releasing the root alone here would tag and publish the wrong thing in a repo that has workspaces, and
  // pnpm refuses to load two of these manifests outright.
  it.each([
    ['the value is not a list', "packages: 'packages/*'\n"],
    ['a non-string entry stands beside a valid pattern', 'packages:\n  - packages/*\n  - 123\n'],
    ['a mis-indented map stands beside a valid pattern', 'packages:\n  - packages/*\n  - apps/*:\n'],
  ])('fails rather than releasing the root where %s', (_condition, manifest) => {
    tree.write('pnpm-workspace.yaml', manifest);

    expect(discoverWorkspaces(tree.dir)).toStrictEqual({
      cause: 'unreadable-packages',
      kind: 'empty',
      patterns: [],
    });
  });

  it('returns the matched packages relative to the root, as POSIX paths', () => {
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");

    expect(discoverWorkspaces(tree.dir)).toStrictEqual({
      kind: 'packages',
      packageDirs: ['packages/alpha', 'packages/legacy'],
      patterns: ['packages/*'],
    });
  });

  // The defect this change repairs: `glob` never applied a `!` entry, so an excluded package reached every
  // tag, publish, and label-sync workflow.
  it('omits a package that a negative pattern excludes', () => {
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n");

    expect(discoverWorkspaces(tree.dir)).toMatchObject({ kind: 'packages', packageDirs: ['packages/alpha'] });
  });

  it('returns the workspace root itself as `.`, which a manifest read resolves against', () => {
    tree.write('package.json', '{"name":"root"}');
    tree.write('pnpm-workspace.yaml', "packages:\n  - '.'\n");

    expect(discoverWorkspaces(tree.dir)).toMatchObject({ kind: 'packages', packageDirs: ['.'] });
  });

  it('never returns a package under node_modules', () => {
    tree.write('packages/alpha/node_modules/installed/package.json', '{"name":"installed"}');
    tree.write('pnpm-workspace.yaml', "packages:\n  - '**'\n");

    expect(discoverWorkspaces(tree.dir)).toMatchObject({
      kind: 'packages',
      packageDirs: ['packages/alpha', 'packages/legacy'],
    });
  });

  // Every release-kit command calls it with no argument, so the default is the seam the whole CLI reads through.
  it('defaults the root to the working directory', () => {
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    disposeOnTestFinished(pointCwdAt(tree.dir));

    expect(discoverWorkspaces()).toMatchObject({
      kind: 'packages',
      packageDirs: ['packages/alpha', 'packages/legacy'],
    });
  });

  describe('a workspace resolving to no package', () => {
    it('reports all-excluded where the exclusions remove every match', () => {
      tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/*'\n");

      expect(discoverWorkspaces(tree.dir)).toStrictEqual({
        cause: 'all-excluded',
        kind: 'empty',
        patterns: ['packages/*', '!packages/*'],
      });
    });

    it('reports no-package where the patterns match no directory holding one', () => {
      tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");

      expect(discoverWorkspaces(tree.dir)).toMatchObject({ cause: 'no-package', kind: 'empty' });
    });

    // An unquoted `!excluded` parses as a YAML tag, leaving an entry the matcher drops. The reader declared
    // packages and got none, which is the condition worth reporting rather than releasing the root.
    it('reports no-pattern where every declared entry fails to become a positive pattern', () => {
      tree.write('pnpm-workspace.yaml', 'packages:\n  - !excluded\n');

      expect(discoverWorkspaces(tree.dir)).toMatchObject({ cause: 'no-pattern', kind: 'empty' });
    });

    // Reported rather than thrown, so that a caller composing a message is the one that decides the failure.
    // Held apart from `no-pattern` because declaring a positive pattern repairs nothing above a syntax error.
    it('reports unreadable-manifest where the manifest holds no valid YAML', () => {
      tree.write('pnpm-workspace.yaml', 'packages:\n  - "unterminated\n');

      expect(discoverWorkspaces(tree.dir)).toStrictEqual({
        cause: 'unreadable-manifest',
        kind: 'empty',
        patterns: [],
      });
    });
  });
});

describe(describeEmptyWorkspace, () => {
  it('names the exclusions for all-excluded', () => {
    const message = describeEmptyWorkspace(emptyWorkspace('all-excluded', ['packages/*', '!packages/*']));

    expect(message).toContain('`packages/*`, `!packages/*`');
    expect(message).toContain('Drop or narrow the exclusion.');
  });

  it('names the `package.json` requirement for no-package', () => {
    const message = describeEmptyWorkspace(emptyWorkspace('no-package', ['apps/*']));

    expect(message).toContain('`apps/*`');
    expect(message).toContain('`package.json`');
  });

  // An unquoted `!pkg` is what YAML leaves empty, and the `no-pattern` remedy is written for that case.
  it('counts the entries YAML left empty rather than quoting them', () => {
    expect(describeEmptyWorkspace(emptyWorkspace('no-pattern', ['', '']))).toContain(
      'declares 2 entries that YAML left empty',
    );
  });

  it('names an emptied entry beside the patterns it stands with', () => {
    expect(describeEmptyWorkspace(emptyWorkspace('no-package', ['packages/*', '']))).toContain(
      'declares `packages/*`, beside 1 entry that YAML left empty',
    );
  });

  // The resolver leaves the patterns empty for both, so neither message leads with the declared-patterns
  // clause that the other three share.
  it('names the syntax error for unreadable-manifest', () => {
    const message = describeEmptyWorkspace(emptyWorkspace('unreadable-manifest', []));

    expect(message).toContain('holds no valid YAML');
    expect(message).toContain('Repair the syntax error');
  });

  it('names the required shape for unreadable-packages', () => {
    const message = describeEmptyWorkspace(emptyWorkspace('unreadable-packages', []));

    expect(message).toContain('not a list of strings');
    expect(message).toContain('Make it a list whose every entry is a quoted pattern');
  });
});
