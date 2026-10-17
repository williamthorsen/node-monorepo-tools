/** Prints the `commit` command's help text. */
export function showCommitHelp(): void {
  console.info(`
Usage: release-kit commit [options]

Stage all changes and create the release commit using tags and summary
produced by \`prepare\`.

Options:
  --dry-run     Preview the commit message without creating it
  --help, -h    Show this help message
`);
}

/** Prints the `create-github-release` command's help text. */
export function showCreateGithubReleaseHelp(): void {
  console.info(`
Usage: release-kit create-github-release [options]

Create GitHub Releases from changelog.json for tags on HEAD. Private
(package.json#private) workspaces are skipped with a warning, and the command
doesn't create a Release for them. A project tag gets a Release even when the
root package is private.

Options:
  --config <path>        Config file, relative to the current directory
                         (default: .config/release-kit.config.ts at the repo root)
  --dry-run              Preview without creating releases
  --tags=tag1,tag2       Only create releases for the named tags (comma-separated, full tag names)
  --help, -h             Show this help message
`);
}

/** Prints the `publish` command's help text. */
export function showPublishHelp(): void {
  console.info(`
Usage: release-kit publish [options]

Publish packages that have release tags on HEAD. Operates only on workspaces whose
package.json#private is absent or false. Without --tags, unpublishable workspaces are
silently filtered out. With --tags, an unpublishable tag is skipped with a warning while
any publishable tags are still published. A project tag is never published.

Options:
  --config <path>        Config file, relative to the current directory
                         (default: .config/release-kit.config.ts at the repo root)
  --dry-run              Preview without publishing
  --no-git-checks        Skip the clean-working-tree check
  --tags=tag1,tag2       Only publish the named tags (comma-separated, full tag names)
  --provenance           Generate provenance statement (requires OIDC, not supported by classic yarn)
  --help, -h             Show this help message
`);
}

/** Prints the `push` command's help text. */
export function showPushHelp(): void {
  console.info(`
Usage: release-kit push [options]

Push the release commit and each tag individually, so that GitHub Actions
starts a separate workflow run for each tag.

Options:
  --config <path>        Config file, relative to the current directory
                         (default: .config/release-kit.config.ts at the repo root)
  --dry-run              Preview without pushing
  --tags=tag1,tag2       Only push the named tags (comma-separated, full tag names)
  --tags-only            Skip the branch push (push tags only)
  --help, -h             Show this help message
`);
}

/** Prints the `show-tag-prefixes` command's help text. */
export function showShowTagPrefixesHelp(): void {
  console.info(`
Usage: release-kit show-tag-prefixes [options]

Print a per-workspace table of derived tag prefixes, tag counts, and declared
legacy tag prefixes. Reports any release-shaped tags whose prefix is neither a
derived prefix nor declared in \`legacyIdentities\`, with a copy-pasteable
config snippet.

Options:
  --config <path>  Config file, relative to the current directory
                   (default: .config/release-kit.config.ts at the repo root)
  --help, -h       Show this help message
`);
}

/** Prints the `tag` command's help text. */
export function showTagHelp(): void {
  console.info(`
Usage: release-kit tag [options]

Create annotated git tags from the tags file produced by \`prepare\`.

Options:
  --dry-run          Preview without creating tags
  --no-git-checks    Skip dirty working tree check
  --help, -h         Show this help message
`);
}
