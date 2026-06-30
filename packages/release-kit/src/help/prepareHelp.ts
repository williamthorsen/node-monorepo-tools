/**
 * Single source of truth for the `release-kit prepare` help text. Imported by the bin
 * dispatcher and asserted by the help drift guard test; kept free of import-time side
 * effects so both can load it.
 */
export const prepareHelpText = `
Usage: release-kit prepare [options]

Run release preparation with automatic workspace discovery.

Options:
  --dry-run             Run without modifying any files
  --bump=major|minor|patch  Override the bump type for all workspaces
  --set-version=X.Y.Z   Set an explicit version; bypasses commit-derived bumps.
                         Requires --only in monorepo mode (rejected when a 'project' block is configured).
  --force               Release even when no commits or no bump-worthy commits exist
                         since the last tag. In monorepo and project mode, defaults to
                         patch when --bump is not given; use --bump=X for a different
                         level. In single-package mode, a bare --force is rejected —
                         pass --bump=major|minor|patch.
  --no-git-checks, -n   Skip the clean-working-tree check
  --only=name1,name2    Only process the named workspaces (comma-separated, monorepo only;
                         rejected when a 'project' block is configured)
  --with-release-notes  Also write per-workspace release-notes previews under {workspacePath}/docs/
                         (docs/README.v{version}.md and docs/RELEASE_NOTES.v{version}.md).
                         Recommended .gitignore entry: packages/*/docs/*.v*.md (or docs/*.v*.md).
  --help, -h            Show this help message
`;

/** Prints the prepare command's help text. */
export function showPrepareHelp(): void {
  console.info(prepareHelpText);
}
