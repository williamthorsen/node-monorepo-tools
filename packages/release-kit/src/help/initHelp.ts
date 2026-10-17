/** Prints the `init` command's help text. */
export function showInitHelp(): void {
  console.info(`
Usage: release-kit init [options]

Initialize release-kit in the current repository.
By default, scaffolds only the GitHub Actions workflow files. When every
package is private, skips publish.yaml and create-github-release.yaml.

Options:
  --with-config   Also scaffold .config/release-kit.config.ts
  --force         Overwrite existing files instead of skipping them
  --dry-run       Preview changes without writing files
  --help, -h      Show this help message
`);
}

/** Prints the `update-templates` command's help text. */
export function showUpdateTemplatesHelp(): void {
  console.info(`
Usage: release-kit update-templates [options]

Update the GitHub Actions workflows that release-kit scaffolds to the templates
of the installed version, showing what changed in each file. Creates a missing
workflow that \`init\` would create, and refreshes sync-labels.yaml only when it
exists. When every package is private, refreshes publish.yaml and
create-github-release.yaml only when they exist. Keeps publish.yaml's provenance
setting. Never touches config files.

Options:
  --dry-run       Preview changes without writing files
  --help, -h      Show this help message
`);
}
