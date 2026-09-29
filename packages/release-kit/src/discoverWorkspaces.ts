import path from 'node:path';

import { type EmptyWorkspaceCause, resolveWorkspace } from '@williamthorsen/nmr-core/workspace';

export type { EmptyWorkspaceCause } from '@williamthorsen/nmr-core/workspace';

/**
 * What release-kit's workspace discovery produced: the repo releases as a single package, it resolves to a
 * set of package directories, or it declares a workspace that resolves to none and the cause says which
 * condition emptied it.
 *
 * Kept separate from nmr-core's `WorkspaceResolution`, whose `packageDirs` are absolute, because these are
 * relative to the monorepo root. The two have incompatible path contracts, and a distinct `kind` for the
 * single-package case keeps either from standing in for the other.
 */
export type WorkspaceDiscovery =
  | { kind: 'empty'; cause: FailingWorkspaceCause; patterns: string[] }
  | { kind: 'packages'; packageDirs: string[]; patterns: string[] }
  | { kind: 'single-package' };

/** A workspace that did not resolve to any package directory, which every release-kit command treats as a failure. */
export type EmptyWorkspace = Extract<WorkspaceDiscovery, { kind: 'empty' }>;

/**
 * The empty-workspace causes that every release-kit command treats as a failure.
 *
 * `no-packages-list` is absent because a manifest declaring nothing releases as a single package, so
 * release-kit's commands never compose a message for it.
 */
export type FailingWorkspaceCause = Exclude<EmptyWorkspaceCause, 'no-packages-list'>;

/**
 * Returns the sentence naming which condition left a workspace without a package directory, and the remedy for
 * it. A message quotes the manifest's `packages` list whenever the manifest declares one that the resolver read.
 *
 * The `package.json` requirement is stated under `no-package` because it is a divergence from pnpm, which
 * recognizes two further manifests, and the reader of a workspace that pnpm resolves cannot infer it.
 */
export function describeEmptyWorkspace(workspace: EmptyWorkspace): string {
  const declaredClause = describeDeclaredPatterns(workspace.patterns);

  switch (workspace.cause) {
    case 'all-excluded':
      return (
        `pnpm-workspace.yaml ${declaredClause}, whose \`!\` entries exclude every directory matched by the ` +
        'positive patterns. Drop or narrow the exclusion.'
      );
    case 'no-package':
      return (
        `pnpm-workspace.yaml ${declaredClause}, and the matcher did not find any directory containing a ` +
        '`package.json`. Add one to the directory that should be a package, or declare a pattern matching a ' +
        'directory that contains one.'
      );
    case 'no-pattern':
      return (
        `pnpm-workspace.yaml ${declaredClause}, so the matcher does not receive any pattern. Declare a positive ` +
        'pattern such as `packages/*`, and quote any `!` entry, which YAML reads as a tag rather than a string ' +
        'when it is unquoted.'
      );
    case 'unreadable-manifest':
      return (
        'pnpm-workspace.yaml does not contain valid YAML, so the matcher does not receive anything that it ' +
        'declares. Repair the syntax error and run the command again. An unterminated quoted string and a ' +
        'mis-indented entry are the usual ones.'
      );
    case 'unreadable-packages':
      return (
        'pnpm-workspace.yaml declares a `packages` value that is not a list of strings, so the matcher does ' +
        'not receive anything that it declares. Make it a list whose every entry is a quoted pattern; a bare ' +
        'value and an entry that YAML read as a number or a map are the usual ones.'
      );
    default: {
      const unhandledCause: never = workspace.cause;
      throw new Error(`Unhandled empty-workspace cause: ${String(unhandledCause)}`);
    }
  }
}

/**
 * Reads `pnpm-workspace.yaml` at `monorepoRoot` and resolves its `packages` patterns, applying pnpm's
 * semantics, `!`-prefixed exclusions included.
 *
 * A directory without a manifest, and one whose manifest does not declare a `packages` list, both release as a
 * single package: pnpm resolves each to the root package alone, and a workspace file kept for `catalog:`,
 * `overrides:`, or `onlyBuiltDependencies:` is the second of them. Every other empty resolution is a failure,
 * whether the manifest declares patterns that match nothing or a `packages` value that the resolver cannot read
 * as patterns at all.
 *
 * `packageDirs` come back relative to `monorepoRoot` as POSIX paths, because that is what every consumer
 * needs: `WorkspaceConfig.paths` feeds `git log -- <paths>`, and `packageFiles` and `changelogPaths` are read
 * from disk relative to the working directory. The workspace root itself relativizes to `.`, the path through
 * which `deriveWorkspaceConfig` reads a root package's manifest.
 */
export function discoverWorkspaces(monorepoRoot: string = process.cwd()): WorkspaceDiscovery {
  const resolution = resolveWorkspace(monorepoRoot);

  if (resolution.kind === 'not-a-workspace') {
    return { kind: 'single-package' };
  }

  if (resolution.kind === 'empty') {
    const { cause, patterns } = resolution;

    return cause === 'no-packages-list' ? { kind: 'single-package' } : { cause, kind: 'empty', patterns };
  }

  return {
    ...resolution,
    packageDirs: resolution.packageDirs.map((packageDir) => relativizeToPosix(monorepoRoot, packageDir)),
  };
}

// region | Helpers

/**
 * Returns the clause naming what the manifest's `packages` key declares, with which every pattern-bearing
 * empty-workspace message leads. Each message calls it with a non-empty list, because the resolver reports a
 * manifest that declares none under a cause of its own.
 *
 * The parser leaves an unquoted `!pkg` as an empty entry, and the matcher drops it. A reader can act on a message
 * that names it as an empty entry: Quoting it renders an empty pair of backticks, and it does so in the one case
 * for which the `no-pattern` remedy is written.
 */
function describeDeclaredPatterns(patterns: readonly string[]): string {
  const quotablePatterns = patterns.filter((pattern) => pattern.trim() !== '');
  const emptiedCount = patterns.length - quotablePatterns.length;

  if (emptiedCount === 0) {
    return `declares ${renderQuotedList(patterns)}`;
  }

  const emptiedClause = `${String(emptiedCount)} ${emptiedCount === 1 ? 'entry' : 'entries'} that YAML left empty`;

  return quotablePatterns.length === 0
    ? `declares ${emptiedClause}`
    : `declares ${renderQuotedList(quotablePatterns)}, beside ${emptiedClause}`;
}

/** Rewrites an absolute package directory as a POSIX path relative to the workspace root. */
function relativizeToPosix(monorepoRoot: string, packageDir: string): string {
  const relativeDir = path.relative(monorepoRoot, packageDir);

  return relativeDir === '' ? '.' : relativeDir.split(path.sep).join('/');
}

/** Renders a pattern list as a comma-separated run of backticked entries. */
function renderQuotedList(patterns: readonly string[]): string {
  return patterns.map((pattern) => `\`${pattern}\``).join(', ');
}

// endregion | Helpers
