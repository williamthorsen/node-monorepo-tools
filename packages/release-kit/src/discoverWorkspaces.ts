import path from 'node:path';

import { resolveWorkspace, type WorkspaceResolution } from '@williamthorsen/nmr-core/workspace';

/** A workspace that resolved to no package directory, which every release-kit command treats as a failure. */
export type EmptyWorkspace = Extract<WorkspaceResolution, { kind: 'empty' }>;

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
 * Reports which of three situations the directory is in: it declares no workspace, which is what selects
 * single-package mode; it resolves to a set of package directories; or it declares a workspace resolving to
 * none, which carries the cause.
 *
 * `packageDirs` come back relative to `monorepoRoot` as POSIX paths, because that is what every consumer
 * needs: `WorkspaceConfig.paths` feeds `git log -- <paths>`, and `packageFiles` and `changelogPaths` are read
 * from disk relative to the working directory. The workspace root itself relativizes to `.`, the path
 * `deriveWorkspaceConfig` reads a root package's manifest through.
 */
export function discoverWorkspaces(monorepoRoot: string = process.cwd()): WorkspaceResolution {
  const resolution = resolveWorkspace(monorepoRoot);

  if (resolution.kind !== 'packages') {
    return resolution;
  }

  return {
    ...resolution,
    packageDirs: resolution.packageDirs.map((packageDir) => relativizeToPosix(monorepoRoot, packageDir)),
  };
}

// region | Helpers

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

/** Renders a pattern list as a comma-separated run of backticked entries. */
function renderQuotedList(patterns: readonly string[]): string {
  return patterns.map((pattern) => `\`${pattern}\``).join(', ');
}

/** Rewrites an absolute package directory as a POSIX path relative to the workspace root. */
function relativizeToPosix(monorepoRoot: string, packageDir: string): string {
  const relativeDir = path.relative(monorepoRoot, packageDir);

  return relativeDir === '' ? '.' : relativeDir.split(path.sep).join('/');
}

// endregion | Helpers
