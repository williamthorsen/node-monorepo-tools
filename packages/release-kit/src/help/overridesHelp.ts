/** Prints the `overrides` command's help text. */
export function showOverridesHelp(): void {
  console.info(`
Usage: release-kit overrides <subcommand> [options]

Manage editorial changelog overrides.

Subcommands:
  validate      Validate every \`.meta/changelog-overrides.json\` file across all scopes

Options:
  --help, -h    Show this help message
`);
}

/** Prints the `overrides validate` subcommand's help text. */
export function showOverridesValidateHelp(): void {
  console.info(`
Usage: release-kit overrides validate

Validate every \`.meta/changelog-overrides.json\` file across the project and per-workspace
scopes. Reports schema/parse errors, ambiguous-prefix errors, conflicting-key errors, and
stale-key warnings.

Exit codes:
  0    Clean: no errors, no stale keys
  1    Stale-key warnings only (no errors)
  2    Schema/parse, ambiguous-prefix, or conflicting-key errors (errors take precedence)

Options:
  --config <path>  Config file, relative to the current directory
                   (default: .config/release-kit.config.ts at the repo root)
  --help, -h       Show this help message
`);
}
