/**
 * Single source of truth for the `release-kit prepare` help text. Imported by the bin
 * dispatcher and asserted by the help drift guard test; kept free of import-time side
 * effects so both can load it.
 */
export const prepareHelpText = `
Usage: release-kit prepare [options]

Run release preparation with automatic workspace discovery.

Options:
  --config <path>       Path to config file (default: .config/release-kit.config.ts)
  --dry-run             Run without modifying any files
  --bump=major|minor|patch  Set the level of every release that happens; does not trigger one
  --set-version=X.Y.Z   Set an explicit version; bypasses the changelog-derived bump. In monorepo
                         mode it requires --only, and is rejected when a 'project' block is configured.
  --force               Release even when no commits or no bump-worthy commits exist
                         since the last tag. Defaults to patch when --bump is not given;
                         use --bump=X for a different level.
  --no-git-checks, -n   Skip the clean-working-tree check
  --only=name1,name2    Only process the named workspaces (comma-separated, monorepo only).
                         When a 'project' block is configured, the project release is skipped.
  --with-release-notes  Also write per-workspace release-notes previews under <workspacePath>/docs/
                         (docs/README.v<version>.md and docs/RELEASE_NOTES.v<version>.md).
                         Recommended .gitignore entry: packages/*/docs/*.v*.md (or docs/*.v*.md).
  --help, -h            Show this help message
`;

/** Prints the prepare command's help text. */
export function showPrepareHelp(): void {
  console.info(prepareHelpText);
}
