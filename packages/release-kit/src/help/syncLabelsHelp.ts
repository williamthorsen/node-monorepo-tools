/** Prints the `sync-labels generate` subcommand's help text. */
export function showSyncLabelsGenerateHelp(): void {
  console.info(`
Usage: release-kit sync-labels generate [options]

Regenerate .github/labels.yaml from the repoLabels block of .config/release-kit.config.ts.

Options:
  --check          Report whether .github/labels.yaml is stale instead of writing it
  --config <path>  Config file, relative to the current directory
                   (default: .config/release-kit.config.ts at the repo root)
  --help, -h       Show this help message
`);
}

/** Prints the `sync-labels` command's help text. */
export function showSyncLabelsHelp(): void {
  console.info(`
Usage: release-kit sync-labels <subcommand> [options]

Manage GitHub label synchronization via preset and custom label definitions.

Subcommands:
  init          Scaffold caller workflow and config, then generate labels
  generate      Regenerate .github/labels.yaml from config
  sync          Trigger the sync-labels workflow via gh CLI

Options:
  --help, -h    Show this help message
`);
}

/** Prints the `sync-labels init` subcommand's help text. */
export function showSyncLabelsInitHelp(): void {
  console.info(`
Usage: release-kit sync-labels init [options]

Scaffold the sync-labels caller workflow and seed the repoLabels block of
.config/release-kit.config.ts with scope labels discovered from workspaces and
retired packages, then generate .github/labels.yaml. When the config file already
exists, print the block for manual paste instead of rewriting the file.

Options:
  --config <path>  Config file, relative to the current directory
                   (default: .config/release-kit.config.ts at the repo root)
  --dry-run        Preview changes without writing files
  --force          Overwrite existing files instead of skipping them
  --help, -h       Show this help message
`);
}

/** Prints the `sync-labels sync` subcommand's help text. */
export function showSyncLabelsSyncHelp(): void {
  console.info(`
Usage: release-kit sync-labels sync

Trigger the sync-labels GitHub Actions workflow via the gh CLI.

Options:
  --help, -h    Show this help message
`);
}
