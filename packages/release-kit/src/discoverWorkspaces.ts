import path from 'node:path';

import { type EmptyWorkspaceCause, resolveWorkspace } from '@williamthorsen/nmr-core/workspace';

export type { EmptyWorkspaceCause } from '@williamthorsen/nmr-core/workspace';

/**
 * What release-kit's workspace discovery produced: the repo releases as a single package, it resolves to a
 * set of package directories, or it declares a workspace that resolves to none and the cause says which
 * condition emptied it.
 *
 * Held apart from nmr-core's `WorkspaceResolution`, whose `packageDirs` are absolute, because these are
 * relative to the monorepo root. The two carry incompatible path contracts, and a distinct `kind` for the
 * single-package case keeps either from standing in for the other.
 */
export type WorkspaceDiscovery =
  | { kind: 'empty'; cause: EmptyWorkspaceCause; patterns: string[] }
  | { kind: 'packages'; packageDirs: string[]; patterns: string[] }
  | { kind: 'single-package' };

/** A workspace that resolved to no package directory, which every release-kit command treats as a failure. */
export type EmptyWorkspace = Extract<WorkspaceDiscovery, { kind: 'empty' }>;

/**
 * Returns the sentence naming which of the four conditions left a workspace holding no package directory, and
 * the remedy for that one. Each quotes the `packages` list the manifest declares, apart from the one whose
 * manifest the reader could not parse and which therefore has no list to quote.
 *
 * The `package.json` requirement is stated under `no-package` because it is a divergence from pnpm, which
 * recognizes two further manifests, and the reader of a workspace that pnpm resolves has no way to infer it.
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
        `pnpm-workspace.yaml ${declaredClause}, and the matcher found no directory holding a \`package.json\`. ` +
        'Add one to the directory that should be a package, or declare a pattern reaching a directory that ' +
        'holds one.'
      );
    case 'no-pattern':
      return (
        `pnpm-workspace.yaml ${declaredClause}, so no pattern reaches the matcher. Declare a positive pattern ` +
        'such as `packages/*`, and quote any `!` entry, which YAML reads as a tag rather than a string where ' +
        'it stands bare.'
      );
    case 'unreadable-manifest':
      return (
        'pnpm-workspace.yaml holds no valid YAML, so nothing it declares reaches the matcher. Repair the ' +
        'syntax error and run the command again. An unterminated quoted string and a mis-indented entry are ' +
        'the usual ones.'
      );
    default: {
      const unhandledCause: never = workspace.cause;
      throw new Error(`Unhandled empty-workspace cause: ${String(unhandledCause)}`);
    }
  }
}

/**
 * Reads `pnpm-workspace.yaml` at `monorepoRoot` and resolves its `packages` patterns, applying pnpm's
 * semantics — `!`-prefixed exclusions included.
 *
 * A directory holding no manifest, and one whose manifest declares no `packages` list, both release as a
 * single package: pnpm resolves each to the root package alone, and a workspace file kept for `catalog:`,
 * `overrides:`, or `onlyBuiltDependencies:` is the second of them. A manifest that declares entries none of
 * which reach the matcher is the failure, because the reader asked for packages and got none.
 *
 * `packageDirs` come back relative to `monorepoRoot` as POSIX paths, because that is what every consumer
 * needs: `WorkspaceConfig.paths` feeds `git log -- <paths>`, and `packageFiles` and `changelogPaths` are read
 * from disk relative to the working directory. The workspace root itself relativizes to `.`, the path
 * `deriveWorkspaceConfig` reads a root package's manifest through.
 */
export function discoverWorkspaces(monorepoRoot: string = process.cwd()): WorkspaceDiscovery {
  const resolution = resolveWorkspace(monorepoRoot);

  if (resolution.kind === 'not-a-workspace') {
    return { kind: 'single-package' };
  }

  if (resolution.kind === 'empty') {
    return declaresNoPackagesList(resolution) ? { kind: 'single-package' } : resolution;
  }

  return {
    ...resolution,
    packageDirs: resolution.packageDirs.map((packageDir) => relativizeToPosix(monorepoRoot, packageDir)),
  };
}

// region | Helpers

/**
 * Reports whether the manifest reached the matcher with no `packages` entry at all, as against entries none
 * of which became a positive pattern.
 *
 * `no-pattern` covers both, and the declared list is what separates them: it is empty where the key is
 * absent, holds no list, or holds a list of non-strings, and non-empty where every entry is an exclusion or
 * an entry YAML left empty.
 */
function declaresNoPackagesList(workspace: EmptyWorkspace): boolean {
  return workspace.cause === 'no-pattern' && workspace.patterns.length === 0;
}

/**
 * Returns the clause naming what the manifest's `packages` key declares, which every empty-workspace message
 * leads with.
 *
 * An entry the parser left empty is what an unquoted `!pkg` becomes, and the matcher drops it. Naming it as an
 * empty entry is what a reader can act on: quoting it renders an empty pair of backticks, and it does so in
 * the one case the `no-pattern` remedy is written for.
 */
function describeDeclaredPatterns(patterns: readonly string[]): string {
  const quotablePatterns = patterns.filter((pattern) => pattern.trim() !== '');
  const emptiedCount = patterns.length - quotablePatterns.length;

  if (emptiedCount === 0) {
    return patterns.length === 0 ? 'declares no `packages` list' : `declares ${renderQuotedList(patterns)}`;
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
