import { OUTPUT_STYLE_ENV_VAR } from '../resolveStylesOrExit.ts';

/** Prints the top-level usage text. */
export function showUsage(): void {
  console.info(`
Usage: release-kit <command> [options]

Commands:
  prepare          Run release preparation (auto-discovers workspaces)
  commit           Stage changes and create the release commit
  tag              Create annotated git tags from the tags file
  push             Push release commit and tags (one push per tag)
  publish          Publish packages with release tags on HEAD
  create-github-release  Create GitHub Releases from changelog.json for tags on HEAD
  show-tag-prefixes  Show derived and declared legacy tag prefixes per workspace
  init             Initialize release-kit in the current repository
  update-templates Update the scaffolded workflows to the current templates
  overrides        Manage editorial changelog overrides
  sync-labels      Manage GitHub label synchronization

Options:
  --dry-run        Preview changes without writing files
  --help, -h       Show this help message
  --version, -V    Show the version number

Environment:
  ${OUTPUT_STYLE_ENV_VAR}
                   Output style: auto (default), plain, or rich. auto prints plain,
                   without emoji, when CI is set or the stream is not a terminal.
`);
}
