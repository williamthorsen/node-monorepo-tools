# Publishing

How `release-kit publish` and `release-kit create-github-release` choose which packages to publish and which tags get a GitHub Release.

## `release-kit publish`

Publishes packages that have release tags on HEAD. The publish workflow's reusable workflow `publish.reusable.yaml` invokes this command in CI.

### Publishability filter

`publish` and `create-github-release` operate only on workspaces whose `package.json#private` is absent or `false`. A workspace marked `private: true` is "versioned but not published": It can still be tagged by `release-kit tag` and get a `CHANGELOG.md` entry, but it is skipped by both `release-kit publish` (no registry publish) and `release-kit create-github-release` (no GitHub Release). `private: true` alone excludes a workspace from publish and announce; it doesn't require any extra release config. Other commands ignore this filter and operate on private workspaces unchanged. A project tag is the exception: `publish` never publishes it, and `create-github-release` creates a Release for it whatever the root `package.json#private` says (see [Project releases](project-releases.md#publishing-and-github-releases)).

An unpublishable tag is always skipped cleanly, never fatal. For `release-kit publish`, whether the skip is announced depends on how the tag was resolved:

- **Without `--tags`** (implicit resolution): Unpublishable tags on HEAD are silently filtered. The pre-publish listing shows only the publishable subset. If the filter empties the set, `release-kit publish` prints `Nothing to publish.` and exits 0.
- **With `--tags`** (explicit naming): Each named tag pointing at an unpublishable workspace is skipped with a warning, and any publishable tags named in the same command are still published.

`release-kit create-github-release` skips unpublishable workspaces with a warning regardless of `--tags`; an all-private tag set is a clean no-op. A project tag is not skipped.

Example warning when an explicit tag is unpublishable:

```
Skipping basic-v1.0.0 (packages/basic): package.json#private is true.
```

### Tarball check

Before it publishes any package, and in a dry run as well, `publish` packs every publishable package from a clean checkout of HEAD and refuses when a tarball lacks a file that its manifest names. It is the same check that `prepare` runs; see [Packages whose tarball would lack a manifest file](releasing.md#packages-whose-tarball-would-lack-a-manifest-file).

### Registry wait

npm processes a publish asynchronously, so a version can be missing from the registry for a minute or more after `npm publish` reports success. After it publishes, `publish` therefore queries the registry for each published version every 10 seconds, revalidating npm's local cache, and returns once every version appears. When a version is still missing after 5 minutes, `publish` fails and names each missing version, together with the registry's error when the query itself failed. A dry run does not wait.

### Dry run

`release-kit publish --dry-run` runs the tarball check and passes `--dry-run` to the package manager, so nothing is published; it skips the clean-tree check. On a HEAD without release tags, which is the state of a pull request, a dry run does not fail: It previews every publishable workspace at its manifest version, and prints a line that says so. A publish that is not a dry run still requires release tags on HEAD.

To check the publish setup on each pull request, call `publish.reusable.yaml` with `dry-run: true` from a workflow triggered by `pull_request`:

```yaml
on:
  pull_request:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  publish-dry-run:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/publish.reusable.yaml@workflow/publish-v2
    with:
      dry-run: true
```

The caller grants the same permissions as a publish caller, which [the workflows README](../../../.github/workflows/README.md) lists; a pull request from a fork does not receive `id-token: write`, so the dry run cannot run on one. A failed dry run does not open a `publish-failure` issue.

## `release-kit create-github-release`

Creates GitHub Releases from `changelog.json` for tags on HEAD. Independent of `npm publish`: Invoking this command creates Releases for publishable packages whether or not they were published to a registry. Private workspaces are skipped, and a project tag gets a Release (see [Publishability filter](#publishability-filter)).

When `--tags` is omitted, every release tag pointing at HEAD is processed. The CLI requires the `gh` CLI on `PATH` and `contents: write` permission. The bundled `create-github-release.reusable.yaml` GitHub Actions workflow runs this command in CI.
