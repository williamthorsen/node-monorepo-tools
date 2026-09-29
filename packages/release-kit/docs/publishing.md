# Publishing

How `release-kit publish` and `release-kit create-github-release` choose which packages to publish and which tags get a GitHub Release.

## `release-kit publish`

Publishes packages that have release tags on HEAD. The publish workflow's reusable workflow `publish.reusable.yaml` invokes this command in CI.

### Publishability filter

`publish` and `create-github-release` operate only on workspaces whose `package.json#private` is absent or `false`. A workspace marked `private: true` is "versioned but not published": It can still be tagged by `release-kit tag` and get a `CHANGELOG.md` entry, but it is skipped by both `release-kit publish` (no registry publish) and `release-kit create-github-release` (no GitHub Release). `private: true` alone excludes a workspace from publish and announce; it doesn't require any extra release config. Other commands ignore this filter and operate on private workspaces unchanged.

An unpublishable tag is always skipped cleanly, never fatal. For `release-kit publish`, whether the skip is announced depends on how the tag was resolved:

- **Without `--tags`** (implicit resolution): Unpublishable tags on HEAD are silently filtered. The pre-publish listing shows only the publishable subset. If the filter empties the set, `release-kit publish` prints `Nothing to publish.` and exits 0.
- **With `--tags`** (explicit naming): Each named tag pointing at an unpublishable workspace is skipped with a warning, and any publishable tags named in the same command are still published.

`release-kit create-github-release` skips unpublishable workspaces with a warning regardless of `--tags`; an all-private tag set is a clean no-op.

Example warning when an explicit tag is unpublishable:

```
Skipping basic-v1.0.0 (packages/basic): package.json#private is true.
```

## `release-kit create-github-release`

Creates GitHub Releases from `changelog.json` for tags on HEAD. Independent of `npm publish`: Invoking this command creates Releases for publishable packages whether or not they were published to a registry. Private workspaces are skipped (see [Publishability filter](#publishability-filter)).

When `--tags` is omitted, every release tag pointing at HEAD is processed. The CLI requires the `gh` CLI on `PATH` and `contents: write` permission. The bundled `create-github-release.reusable.yaml` GitHub Actions workflow runs this command in CI.
