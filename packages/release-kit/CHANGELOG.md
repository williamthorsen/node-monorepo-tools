# Changelog

All notable changes to this project will be documented in this file.

## 10.4.3 — 2026-08-20

### 🧪 Tests

- Register the working directory for disposal alongside the tree it points into (#724)

  Converts the `release-kit` and `v11y-check` suites that run from inside a temporary directory to `createTempTree` and `pointCwdAt`, registered through `disposeOnTestFinished` or scoped with `using`. Reverse-order disposal now restores the working directory before removing the tree it pointed into, which each suite previously had to sequence by hand.

- Route the remaining hand-built temporary directories through createTempTree (#725)

  Replaces the hand-built temporary directories in the `release-kit` and `v11y-check` test suites with a `createTempTree` fixture, dropping the `beforeEach`/`afterEach` pairs that created and removed them.

## 10.4.2 — 2026-08-19

### 🧪 Tests

- Register fixture-repo cleanup against the test that asks for it (#715)

  Routes nmr's `buildRepo` fixture helper through `createTempTree`, registering each fixture directory's removal against the test that requested it. The module-level accumulator and the exported `removeFixtureDirs` have been removed.

- Convert the per-test temporary directories to test-scoped fixtures (#719)

  Converts the suites that create a temporary directory in `nmr`, `nmr-core`, and `release-kit` to take it as a Vitest fixture built on `createTempTree`, or as a `using` declaration where the directory lives and dies inside one test body. Each suite loses the mutable binding and the `beforeEach`/`afterEach` pair that carried the directory's lifetime, and a directory is created only for the tests that name one.

  Separately, `nmr lint:strict` now fails on a stale `eslint-disable` directive.

- Register temporary-directory disposal where a helper holds the binding (#721)

  Routes the temporary directory through `createTempTree` in the `nmr` and `release-kit` test suites whose describe-local helpers hold its binding, and registers its removal with `disposeOnTestFinished`. The hand-written `afterEach` teardown goes; the binding stays, so no suite helper changes signature.

## 10.4.1 — 2026-08-18

### 🐛 Bug fixes

- Accept `--only` under a project block, skipping the project release (#702)

  Fixes an issue where `release-kit prepare --only` exited with an error in any repo whose config declares a `project` block, which left the `only` dispatch input that `release-kit init` scaffolds into `release.yaml` unusable. A narrowed run now releases the named workspaces and skips the project release, reporting the skip and the selection that caused it as a warning.

- Route release-notes preview warnings through the prepare plan (#705)

  Fixes an issue where `release-kit prepare --with-release-notes` printed its diagnostics to stderr ahead of the release report, and described a skipped release-notes preview as a skipped README injection. The messages now render as `⚠️` lines inside the report and are worded for release-notes previews; a skip belonging to one workspace names that workspace.

## 10.4.0 — 2026-08-17

### 🎉 Features

- Let a project release cover repo-root paths (#685)

  Extends `release-kit`'s project release to a repo whose content lives at the root. Such a repo declares `project: { paths: ['**'] }` and gets the root `CHANGELOG.md`, the root `.meta/changelog.json`, the `--with-release-notes` previews under root `docs/`, the root `package.json` bump, and the project tag that the stage produces.

  `paths` scopes any project release's window, not only the whole-tree case, and the project tier of `release-kit validate-overrides` with it. A declared value replaces the workspace union rather than extending it; omitting `paths` resolves to that union, so existing consumers see no change.

### ♻️ Refactoring

- Adopt silenceConsole across the test suites (#677)

  Adopts `silenceConsole` from `@williamthorsen/toolbelt.vitest` to replace all hand-rolled `vi.spyOn(console, …)` spies and reduce boilerplate across the repo's test suites. The function returns a disposable, allowing the caller to use `using` to enable restoration of the console method at the end of the test scope.

- Adopt `isError` and consolidate errno narrowing on a shared helper (#697)

  Replaces every hand-rolled `instanceof Error` narrowing with `hasErrnoCode`, a new predicate exported from `@williamthorsen/nmr-core`, or with `isError` from `@williamthorsen/toolbelt.errors`. Previously the errno question was answered by inline copies alongside two private helpers of differing shape; both helpers are removed.

  Separately, `eslint.config.ts` now bans `instanceof Error` in every position rather than in a ternary alone.

### 🧪 Tests

- Replace the stdio spies with captureStdio (#678)

  Replaces every `process.stdout` and `process.stderr` spy in the test suites with `captureStdio` from `@williamthorsen/toolbelt.testing` and deletes the obviated local capture helpers. `captureStdio` buffers writes rather than recording calls, so assertions that previously used `toHaveBeenCalledWith` instead check `stderr`/`stdout` strings and their chunk arrays.

  Separately, `unicorn/no-nonstandard-builtin-properties` is off for test files. Its hand-maintained symbol table omits `Symbol.dispose`, which a suite-scoped capture calls to restore the streams, and `schema: []` offers no way to extend the table.

- Adopt throwOnProcessExit and captureError across the test suites (#690)

  Adopts `throwOnProcessExit` from `@williamthorsen/toolbelt.vitest`, replacing every hand-rolled `process.exit` mock in the `release-kit` and `nmr-core` test suites, and `captureError` from `@williamthorsen/toolbelt.testing`, replacing inline try/catch/`instanceof` blocks.

  Separately, `@williamthorsen/toolbelt.vitest` is now listed in the ReadyUp config, so that its kit is run by `rdy run --packages`.

## 10.3.2 — 2026-08-13

### ♻️ Refactoring

- Adopt toolbelt.errors for error-message extraction and cause-chaining (#652)

  Improves error reporting by adopting standardized ways of capturing and describing errors across the codebase.

### ⚙️ Tooling

- Upgrade the lint config and clear its violations (#671)

  Upgrades `@williamthorsen/eslint-config-typescript`, along with other config packages, and clears lint violations surfaced by the newly activated rules.

## 10.3.0 — 2026-08-08

### 🎉 Features

- Stop reporting absence checks that pass (#610)

  A ReadyUp check that checks for a problem (such as an unwanted file or a stale config reference) now stays silent unless it finds one. The `nmr`, `release-kit`, and `v11y-check` ReadyUp kits previously printed a line for every such check on every run.

- Stop reporting non-issues in the readyup kits (#613)

  Modifies the `release-kit` and `nmr` ReadyUp kits to avoid verbose reporting when an initial check determines that further checks aren't applicable. In particular, a repo with no `release-kit` config file gets a single line in the `release-kit` report, and a repo that publishes nothing now bypasses the `npm-auto-publish` kit instead of failing it.

### 🐛 Bug fixes

- Publish build output atomically so a failed build cannot destroy it (#631)

  Fixes an issue where a failed or still-running `nmr build` could leave a package with no build output at all, breaking the tooling that a subsequent build depends on. Separately, the error reported when a package's build output is missing now names the correct recovery command.

### ♻️ Refactoring

- Retire the deferred-lint-rule list and enforce its rules (#628)

  Errors that `release-kit` rethrows now carry the original error as their cause, previously available only as message text. Help text and documentation for `--with-release-notes` now use the same placeholder notation for its output paths.

  All violations of lint rules in the `release-kit` project are now cleared, and the list of deferred lint rules is retired, restoring associated rules to a max severity of "error" during strict linting.

### ⚙️ Tooling

- Migrate to the shared tsconfig baseline (#626)

  Adopts `@williamthorsen/tsconfig` as the standard TypeScript configuration for this repo, replacing the previous hand-maintained copy. Reading a property through an index signature now requires bracket notation or a type that declares the property. The `nmr` build now fails on a base TypeScript config it cannot resolve, rather than building without it, and it now resolves a base config named by package name alone.

## 10.2.2 — 2026-08-05

### 🐛 Bug fixes

- Report the missing npm login once, not per package (#598)

  Fixes an issue where running release-kit's publish-readiness checks without an npm login reported a trusted-publisher failure for every published package. The missing login is now reported once, with `npm login` as the fix. An unreachable registry now has its own check. The trusted publisher check produces more informative failure messages.

- Make prepare all-or-nothing and report the tags file by path (#601)

  Fixes an issue where a failed `prepare` could leave the release flow in a broken intermediate state. A release now lands completely or not at all, and a formatting failure no longer discards one that already landed. When a write fails partway, the error names every file that reached disk, every file that did not, and the commands that undo them.

  `commit` and `tag` now report the full path of the tags file they looked for, and distinguish a missing file from one that could not be read, so that running from the wrong directory or worktree is no longer reported as a release that never happened.

  Runs with `--with-release-notes` now list the preview files they write, and `--dry-run` names the ones a real run would write.

### 🧪 Tests

- Clear the deferred vitest test rules and enforce them (#602)

  Fixes a subset of previously deferred lint violations and restores the severity of Vitest lint rules to "error" for purposes strict linting.

## 10.2.1 — 2026-08-04

### 🐛 Bug fixes

- Remove the 1 MiB ceiling on captured git output (#596)

  Fixes an issue where `release-kit prepare` began aborting once a repository's release history grew long enough, leaving that repository unable to cut another release. The fix covers, in addition to `prepare`, every other release-kit command that reads from git.

## 10.2.0 — 2026-08-04

### 🎉 Features

- Add status labels and clear grouped-label descriptions (#585)

  Adds two status labels (`status:blocked` and `status:on-hold`) to the common preset and removes descriptions from other scoped labels (`priority:` and `value:`) to keep scoped groups compact in the GitHub UI.

- Publish each package's readyup kit from the package that owns it (#590)

  ReadyUp checks for `@williamthorsen/nmr`, `@williamthorsen/release-kit`, and `v11y-check` are now run directly against these packages, guaranteeing a version-appropriate check, instead of against their host repo. The package must be installed as a direct dependency in the calling repo.

  The syntax is `rdy run --from npm:<package>`. `rdy run --packages` runs the kits contained in any packages listed in `.config/readyup.config.ts`. Requires `readyup` 0.23 or later.

## 10.1.0 — 2026-08-03

### 🎉 Features

- Publish nmr's readyup kit with a test-tier conformance check (#580)

  `@williamthorsen/nmr` is now bundled with ReadyUp kits that check a repo's alignment with `nmr` requirements and recommendations.

  `rdy run --from npm:@williamthorsen/nmr` checks the repo against the kits without prior configuration. Once the package is added to the ReadyUp config, `rdy run --packages` will run the `nmr` kits along with those of any other registered package. Requires `readyup` v0.23 or greater.

### ♻️ Refactoring

- Load the config with Node's TypeScript support instead of jiti (#573)

  `release-kit` now uses native Node with type-stripping to read its configs. `jiti` is no longer needed as a dependency. As a result, relative imports inside `.config/release-kit.config.ts` now require an explicit file extension.

## 10.0.0 — 2026-08-03

### 🎉 Features

- 🚨 **Breaking:** Retire integration label in favor of an isolation-tier test ladder (#552)

  Test groups are now named for what a test reaches rather than for how much of the codebase it covers: `integration` and `app` are replaced by `unit`, `tool`, `localhost`, and `remote`.

  `nmr test` now runs the `tool` group alongside `unit`, so the first run after upgrading may fail on tests that nothing was running before. Upgrading means renaming `*.int.test.ts` files onto the new groups and replacing `nmr test:integration` with `nmr test:tool`.

### ♻️ Refactoring

- 🚨 **Breaking:** Move defineConfig to a dedicated config subpath (#566)

  `defineConfig` now comes from the `@williamthorsen/release-kit/config` subpath rather than from the package root. The subpath also carries the config types.

- Share nmr-core's cache primitives with nmr-compile (#570)

  A package's writes to the build cache are now hidden from other packages until the write is complete. A failing build now reports its error in the same form as every other `nmr` command. `tsx` is no longer required to build a package.

## 9.1.0 — 2026-07-31

### 🎉 Features

- Make label descriptions optional and generate none for scope labels (#539)

  `release-kit` now supports labels without a description, and `release-kit sync-labels init` generates scope labels without one. Applying a label without a description clears any existing description the repository carries for that label.

## 9.0.1 — 2026-07-30

### ⚙️ Tooling

- Adopt Vitest projects in this repo (#530)

  Simplifies test configurations so that every package exposes the same test commands, which select suites by test category: `nmr test` runs everything except integration tests, `nmr test:integration` runs only those, and `nmr test:all` runs both. `nmr test:integration` now succeeds in a package that has no integration tests instead of failing. release-kit's drift checks can now be run on their own, apart from unit and integration tests. A fresh clone now has to run `pnpm run bootstrap` before any test run, not just before `nmr` commands.

## 9.0.0 — 2026-07-28

### 🎉 Features

- 🚨 **Breaking:** Unify label configuration in release-kit.config.ts (#505)

  Repositories now declare their label set alongside the rest of their release-kit configuration in `.config/release-kit.config.ts`, and the declaration is validated and completed in the editor as it is written. A label supplied by a bundled preset can now be recolored, reworded, or dropped. `sync-labels generate --check` now reports when the committed label file has fallen behind the declaration, writing nothing. The standalone `.config/sync-labels.config.ts` is no longer read; while it remains in place, every `sync-labels` command refuses to run, naming what to move and where.

### 🐛 Bug fixes

- Include commits scoped to `*` in the changelog (#496)

  Fixes an issue where commits scoped to `*` raised the version but were silently dropped from the generated changelog.

## 8.1.0 — 2026-07-22

### 🎉 Features

- Make label deletions reviewable and apply labels on merge (#493)

  Pull requests that touch a repository's label file now get a check listing every label change the sync would make, including deletions of labels the file never mentions, which a diff of the file cannot show. Merging the pull request now applies those labels. The sync's deletion and rename handling now changes only through a reviewed upgrade to a verified release. Repositories that already scaffolded this workflow adopt the new triggers by re-running `release-kit sync-labels init --force`.

### 📦 Dependencies

- Upgrade dependencies and align the Node support policy (#483)

  All four published packages (`nmr`, `nmr-core`, `release-kit`, and `v11y-check`) now require Node.js 24 or later, up from Node 18.17. Separately, `nmr-compile` now rebuilds when the TypeScript version changes.

## 8.0.1 — 2026-07-18

### 🐛 Bug fixes

- Skip private packages cleanly in publish and create-github-release (#477)

  Fixes an issue where a workspace marked private in its `package.json` could break a release: `release-kit publish` failed on it, and `release-kit create-github-release` created an unwanted public GitHub Release for it. Both commands now skip private workspaces cleanly: publish reports the skip and continues instead of failing the run, and create-github-release produces no Release for a private package. Any publishable packages released alongside it still publish and still get their Releases. Marking a workspace private is now all it takes to exclude it from both publishing and GitHub Releases.

## 8.0.0 — 2026-07-13

### 🎉 Features

- 🚨 **Breaking:** Fail a package that declares types but ships none (#467)

  `nmr attw` now fails a package that claims to ship type declarations but ships none. Such a package used to pass, leaving every TypeScript consumer of it silently typed as `any`.

  A package that ships working declarations found only by sitting beside its JavaScript entry point escapes the check, since it declares nothing. Add a `types` entry to bring it under the check.

## 7.0.0 — 2026-07-01

### 🎉 Features

- 🚨 **Breaking:** Rebuild nmr-compile on a unified tsc emit (#455)

  `nmr` now compiles a package's JavaScript and type declarations in one step, rewriting every import form — static, re-export, dynamic `import()`, bare side-effect, and tsconfig `paths` aliases — to runnable `.js` in both outputs. It now requires TypeScript 5.7 or newer as a peer dependency.

## 6.0.0 — 2026-06-30

### 🎉 Features

- 🚨 **Breaking:** Rewrite parseArgs on node:util with typed error and exit API (#428)

  `@williamthorsen/nmr-core` gains a typed error API for CLI parsing: `parseArgsOrExit` (parse, or print a usage error and exit) and `ParseError` replace the per-command boilerplate, so every bundled CLI reports a flag mistake the same way. Breaking: the `translateParseError` export is removed and `parseArgs` now throws `ParseError`.

- 🚨 **Breaking:** Auto-activate integration test variant from config presence (#448)

  A package can now separate its integration tests from its standalone suite simply by including a `vitest.integration.config.ts` (alongside a `vitest.standalone.config.ts`). The `--int-test` flag that previously enabled this is removed — that config-file pairing is now the only way to activate the separation. In such a package, `test` and `test:coverage` run only the standalone suite and skip integration tests, while a new `test:all` runs both suites together. The separation now holds even when tests run across every package at once, so a full-workspace `test` run still keeps integration tests out of the default suite. Packages that previously hand-copied these test scripts no longer need to.

### ♻️ Refactoring

- Route all CLI error reporting through a single stderr helper (#437)

  Consolidates error reporting across the CLIs so every command reports errors the same way, and guards against the previous inconsistency returning. The error messages and exit codes users see are unchanged.

- Normalize CLI error wording to the canonical Error: format (#439)

  Single-line error messages from the `nmr` and `release-kit` commands now print in one uniform shape, so the same class of failure reads the same way no matter which command produced it. Previously the wording varied, which made error output harder to scan and harder for scripts to match against. Richer output, such as multi-line validation reports and the stack trace from an unexpected crash, is unchanged.

- Consolidate prepare parsing onto parseArgsOrExit (#441)

  Makes `release-kit`'s `prepare` command report invalid arguments the same way its other commands already do. The error message and exit code a user sees for a bad argument are unchanged.

- Unify prepare help text into a testable module (#443)

  Running `release-kit prepare --help` now lists the complete set of options. The `--force` flag and the restriction that `--set-version` and `--only` cannot be used when a project block is configured were previously missing from the help and are now shown there; the same `--set-version` restriction was added to the package README's `prepare` reference.

### 📚 Documentation

- Document single-package --force rejection in release-kit prepare (#450)

  The `release-kit prepare` `--force` documentation now correctly describes per-mode behavior: a bare `--force` is rejected in a single-package repo, where an explicit `--bump` level must be passed, while the "defaults to patch" shortcut applies only in monorepo and project mode.

## 5.4.0 — 2026-06-27

### 🎉 Features

- Centralize the per-package build as an nmr-compile bin (#419)

  Introduces `nmr-compile`, a single command shipped with `@williamthorsen/nmr` that compiles each workspace package and now backs the default build. Consuming repos can delete their own per-package build script and pick up future build fixes just by upgrading nmr. Repeated builds with unchanged source now reliably skip recompiling instead of occasionally rebuilding for no reason, and import aliases now resolve correctly in symlinked checkouts.

## 5.3.2 — 2026-06-16

### ♻️ Refactoring

- Migrate from js-yaml to yaml (#410)

  Replaces the `js-yaml` dependency with the `yaml` package for all YAML reading and writing, with no change to behavior or generated output. The swap trims the dependency footprint by dropping a direct dependency and its companion type-definitions package, since `yaml` ships its own types.

## 5.3.1 — 2026-05-19

### 🐛 Bug fixes

- Validate overrides against the full release history (#401)

  Fixes an issue where `release-kit overrides validate` reported overrides as stale when they targeted commits in past releases, even though `release-kit prepare` correctly matched them. The two commands now agree on which overrides are stale.

### ♻️ Refactoring

- Restructure tests and align core package directory with package name (#405)

  Tests in every package are now typechecked alongside the code they cover, so type breakage in tests fails the build instead of slipping through. The `core` package's workspace directory is renamed to match its package name, so `nmr -F nmr-core ...` and `pnpm --filter nmr-core ...` now resolve where they previously failed.

## 5.3.0 — 2026-05-10

### 🎉 Features

- Enable editorial overrides for changelog entries (#387)

  Allows `release-kit` consumers to skip or correct historical changelog entries by means of an overrides file.

- Decentralize changelog overrides to per-scope .meta/ files (#391)

  Adds support for workspace-scoped editorial-override files for `release-kit`-generated changelogs. A repo-root file applies overrides to every workspace's changelog; a workspace-tier file applies only to that workspace.

- Add section markers and authenticated upstream fetch (#393)

  A new `markers` block in `work-types.json` describes the breaking-changes emoji and label, making them available for use by consumers.

  `work-types check` and `work-types sync` now authenticate when `GITHUB_TOKEN` is set, so they can reach private upstream repositories.

- Validate changelog overrides from the command line (#395)

  Adds a `release-kit overrides validate` subcommand that audits every `.meta/changelog-overrides.json` file across the project root and per-workspace scopes in one pass. The command reports schema errors, ambiguous-prefix collisions, and stale-key warnings with tiered exit codes so CI can choose its own failure threshold. The same validation is also available via a library function exported by the package.

### 🐛 Bug fixes

- Suppress git-cliff stale-version warnings on prepare (#373)

  Fixes an issue where `release-kit prepare` repeatedly printed git-cliff's "A new version of git-cliff is available" notice — twice per release unit, so 2 × N times for an N-package monorepo run — while never updating the locally cached git-cliff binary. Each `prepare` run now revalidates the npm cache once before any cliff work, so the binary stays current with upstream releases and the notice no longer surfaces on every per-workspace invocation.

- Use synthetic changelogs for forced empty-range releases (#376)

  Fixes an issue where `release-kit prepare` with `--force`, `--bump=X`, or `--set-version` would invoke git-cliff against units that had no commits since their last tag, surfacing confusing `WARN  git_cliff > There is already a tag (...)` lines (twice per affected unit) and silently leaving `CHANGELOG.md` and `.meta/changelog.json` stale. Empty-range bumps now write a synthetic `Notes / Forced version bump.` entry to both files instead of invoking git-cliff. Applies to all three release stages: single-package, per-workspace, and project. Prior changelog history is preserved on every path.

- Accept `breakingPolicies` field in config files (#394)

  Fixes an issue where setting `breakingPolicies` in `release-kit.config.ts` was rejected as an unknown field, leaving per-work-type breaking-policy configuration unreachable from the config file. Each entry accepts `'forbidden'`, `'optional'`, or `'required'`; an empty object opts out of enforcement.

## 5.2.1 — 2026-05-05

### 🐛 Bug fixes

- Soft-skip tags with no changelog entry under --tags (#366)

  Fixes an issue where `release-kit create-github-release --tags <tag>` exited 1 — failing the calling CI workflow — when the requested tag had no changelog entry. Tooling-only releases (those whose changelog generator legitimately omits an entry) are now soft-skipped with an info-level summary, the same as releases skipped because their entry has no audience-relevant content. Typo protection is preserved: passing an unknown tag to `--tags` still exits 1.

## 5.2.0 — 2026-05-04

### 🎉 Features

- Add emojis to changelog and release-note headings (#352)

  Adds emoji prefixes to the section headings rendered in `CHANGELOG.md` and release notes generated by `@williamthorsen/release-kit`. Each of the 13 default work types gets a single decorative emoji so its section is easier to spot when skimming a release: 🐛 Bug fixes, 🎉 Features, 📚 Documentation, ♻️ Refactoring, ⚡ Performance, 🔒 Security, 🧪 Tests, ⚙️ Tooling, 👷 CI, 📦 Dependencies, 🏗️ Internal, 🗑️ Deprecated, and 🤖 Agentic support. Matching of `changelogJson.devOnlySections` is emoji-tolerant: existing consumer overrides written as bare names continue to work without modification.

- Surface bang violations in release prepare reports (#359)

  Release-prepare flows now surface `!`-policy violations as warnings in the prepare report. Each workspace's and project's commit window is parsed against the default policy table — `internal!` is rejected as contradictory, bare `drop:` is rejected for missing the required `!`, and so on — and any violations appear under the workspace's section in the report alongside short hash, truncated subject, type, and surface (prefix or body). A new `breakingPolicies` config field lets consumers override individual entries or pass `{}` to disable enforcement entirely. Release-time enforcement remains tolerant: violations are warnings, never failures, so a single legacy commit cannot block a release.

### 🐛 Bug fixes

- Restrict publish to publishable workspaces (#345)

  Fixes an issue where `release-kit publish` failed for workspaces marked `package.json#private: true`. The command now operates only on publishable workspaces — those where `private` is absent or `false` — and the rest of the release pipeline (`tag`, `create-github-release`, `prepare`, changelog) continues to handle private workspaces unchanged. This preserves the "versioned but not published" workflow: a private workspace can still be versioned, tagged, and published as a GitHub Release; only the registry-publish step is skipped. Without `--tags`, unpublishable tags are silently filtered (an empty result prints `Nothing to publish.` and exits 0). With `--tags` naming an unpublishable workspace, `release-kit publish` exits 1 with one error per offending tag, citing `package.json#private` and the workspace path.

- Skip tooling-only releases instead of failing (#347)

  Fixes an issue where `release-kit create-github-release --tags <tag>` exited 1 whenever the tag's changelog had no all-audience content. The reusable `create-github-release.reusable.yaml` workflow forwards `github.ref_name` into `--tags`, so tooling-only releases consistently produced failed workflow runs even though no failure occurred. The command now exits 1 only when a requested tag has no changelog entry; intentional skip reasons (`no-audience-content`, `empty-body`) are informational. A typoed tag still surfaces an error even when batched alongside successful tags, and the info summary reports the per-tag skip reason for diagnostic visibility.

- Establish canonical work-types SSOT and restore changelog section ordering (#358)

  Restores canonical section ordering in changelogs and release notes — sections were appearing in unpredictable order after the previous release added emoji prefixes to section headers. Sections now follow a stable priority: public-facing types (Features, Fixes, Security, …) first, then internal types, then process types. Release-note bullets for breaking changes carry a `🚨 **Breaking:**` prefix so they stand out at a glance. Documentation entries move out of public release notes — they continue to appear in dev changelogs.

  Closes #355.

### ⚡ Performance

- Skip npx registry revalidation when running git-cliff (#361)

  Speeds up `release-kit prepare` by skipping the npm registry cache-revalidation HTTP request that ran on every `git-cliff` invocation. Per-invocation overhead drops from ~4.6 s to ~2.0 s; in a four-workspace monorepo this saves about 10 seconds per run. Also suppresses a transient stderr spinner that briefly appeared during package resolution and looked like a half-complete log message. Network fallback is preserved — runs on machines with an empty npx cache still resolve `git-cliff` over the network.

### ♻️ Refactoring

- Read package version at runtime via shared helper (#338)

  Fixes an issue where running `audit-deps`, `nmr`, or `release-kit` from the locally built `dist/esm/` after a `git pull` could report a stale version. Each CLI now reads its version directly from its `package.json` at startup, so version reads stay in sync with the installed source without requiring a fresh `pnpm install` or rebuild.

## 5.1.0 — 2026-04-30

### 🎉 Features

- Add `project` block for project-level release stage (#317)

  Adds support for monorepos that ship a single combined deliverable to version, changelog, and release-note the project itself rather than only its constituent workspaces.

- Publish JSON Schema for `.meta/label-map.json` (#325)

  Adds a JSON Schema for `.meta/label-map.json` to release-kit, packaged at `packages/release-kit/schemas/label-map.json` and shipped to npm. Consumers reference it via the stable raw URL pattern `https://github.com/williamthorsen/node-monorepo-tools/raw/release-kit-v<version>/packages/release-kit/schemas/label-map.json` — the same shape audit-deps already uses.

- Label prepare errors with the failing stage (#326)

  Adds stage attribution to errors thrown during `release-kit prepare`. Errors from per-workspace bumps and changelog generation, the project release stage, and the post-release format command now begin with a stage label that identifies the failing stage and (where relevant) the affected workspace.

- Make `--force` and `--bump` orthogonal (#328)

  Decouples `--force` and `--bump` so each flag has a single responsibility, and unifies skip semantics across the per-workspace and project pipelines.

### 🐛 Bug fixes

- Make publish's clean-tree safety gate reachable (#311)

  Fixes an issue where `release-kit publish` failed with pnpm's "working tree is dirty" error on a clean tree whenever `releaseNotes.shouldInjectIntoReadme: true` was configured. release-kit injects the release notes into the package README before invoking `pnpm publish`, so pnpm's own working-tree check fired on a tree release-kit had just dirtied — even though the user's tree was clean at command start.

- Make `--set-version` + `project` rejection explicit (#319)

  Improves the error users see when invoking `release-kit prepare --set-version` with a `project` block configured. The combination is still rejected — as before — but now produces a single, project-aware message ("--set-version cannot be combined with a project release…") rather than the previous two-step chain (`--set-version requires --only`, then `--only cannot be combined with a project release` after the user added `--only`).

- Reject `--only` that would strand excluded dependents (#321)

  Fixes a silent footgun in `release-kit prepare --only=...`: an excluded internal dependent with its own changes would be left unreleased with no runtime signal, even though the targeted workspace it depends on was being released. The command now rejects such invocations up front, naming every excluded dependent whose changes would be stranded.

- Order prerelease versions correctly in changelog sort (#334)

  Fixes a latent issue in `@williamthorsen/release-kit` where prerelease version tags (e.g., `1.2.3-alpha`, `1.2.3-rc.1`) were sorted as if their prerelease component were absent, causing them to appear in the wrong position relative to releases sharing the same base version. Changelog entries are now ordered per SemVer §11: prerelease versions precede the corresponding release (`1.2.3-alpha < 1.2.3`), build metadata is ignored for ordering, and entries that fail SemVer validation sort deterministically to the bottom of the list rather than collapsing into mid-list positions.

### ♻️ Refactoring

- Convert prepare results to discriminated unions (#330)

  Tightens `ProjectPrepareResult` and `WorkspacePrepareResult` from flat-with-optionals types into status-discriminated unions, so consumers that have already narrowed on `status === 'released'` no longer need to re-guard each release-only field with `!== undefined`. The four new sub-types (`ReleasedProjectResult`, `ReleasedWorkspaceResult`, `SkippedProjectResult`, `SkippedWorkspaceResult`) are exported from the package so callers can name the variants directly. Renderer output is byte-identical to before.

- Split changelog.json generation into layered helpers (#333)

  Reorganises `changelog.json` generation in `@williamthorsen/release-kit` so that producing entries (running git-cliff and shaping the output) is fully separated from persisting them (reading, merging, and writing the file). Removes the silent-discard parse-failure path at the project release stage by no longer reading the root `changelog.json` before overwriting it. Sharpens dry-run mode: `git-cliff` now runs even on dry-run so configuration mistakes surface in preview rather than only on a real release. Trims the public `index.ts` barrel from ~50 re-exports to the two type names actually consumed by external configs.

### 🧪 Tests

- Cover untested project-release and config branches (#329)

  Closes four mechanical test-coverage gaps in the project-level release surfaces flagged in the test review of #308. New cases exercise the `(no previous release found)` rendering for released projects, the unparseable-commit warning block on the released-project rendering path, the `readFileSync` I/O failure path in `readRootPackageVersion`, and the contributing-paths invariant in `releasePrepareProject`. No production code changes — these are pure-render and pure-derivation branches that previously had no test exercising them.

### 📚 Documentation

- Document tag prefix collisions as general rule (#320)

  Documents the strict-prefix tag-prefix collision rule as a general validation rule that applies to every release-kit consumer declaring more than one tag prefix: across active workspaces, declared legacy identities, retired packages, and the optional `project` block. Previously, the rule appeared only inside the `Project releases` validation list.

## 5.0.0 — 2026-04-23

### 🎉 Features

- Improve release-notes rendering quality (#261)

  Improves the quality of release notes and CHANGELOG entries generated by release-kit. Release notes sections are now ordered by work-type priority (bug fixes first, then features, then internal), and each bullet now includes the commit body text for context that a one-line title cannot provide. Refactoring commits are now excluded from the release notes.

- Scaffold release-notes injection and check markers (#267)

  Adds release-notes injection to the configs scaffolded by `release-kit init`, so newly-onboarded consumers get the feature without having to discover or toggle the flag. The release-kit readyup kit gains a check that warns when a consumer's README is missing the marker pair where injected notes should land — without those markers, injection silently prepends to the top of the file, pushing the README's title below the notes.

- 🚨 **Breaking:** Split GitHub Release creation into its own workflow (#272)

  Splits GitHub Release creation out of release-kit publish into a dedicated release-kit create-github-release CLI command and a matching reusable GitHub Actions workflow. Consumers that do not publish to npm can now create Releases independently, and the contents: write permission required to create a Release no longer leaks into the publish path.

- 🚨 **Breaking:** Replace --only with --tags on release-kit publish and push (#273)

  `release-kit publish` and `release-kit push` now filter by full tag name via `--tags=<tag1,tag2>` instead of workspace directory name via `--only=<dir>`, matching the shape already used by `create-github-release`. Callers pass the tag they care about (e.g., `core-v1.3.0`) directly, with no translation step back to the publishing workspace's directory name. The reusable workflow gains an optional `tags:` input, and the internal `publish.yaml` caller now passes `tags: ${{ github.ref_name }}`, making the publish scope explicit rather than relying on the single-tag fetch default of `actions/checkout@v6`.

- Apply pre-1.0 bump rule and add --set-version CLI escape hatch (#274)

  Fixes an issue where a `feat!` commit on a pre-1.0 package would accidentally promote it to `1.0.0`. At pre-1.0 (`0.y.z`), a `'major'` release type now collapses to a minor bump. Adds a validated `--set-version <semver>` CLI flag on `release-kit prepare` that bypasses commit-derived bump logic and writes a specific version.

- Scaffold audit.yaml workflow from audit-deps init (#277)

  Adds GitHub Actions workflow scaffolding to `audit-deps init`. Running the command now writes both `.config/audit-deps.config.json` and `.github/workflows/audit.yaml` in the target repo, so that consumers no longer have to copy the canonical caller workflow by hand from this repo. The workflow content is shipped as a bundled template that ships to npm, and the repo's own workflow is kept byte-identical to that template via a consistency test — the canonical workflow cannot silently drift from what is published.

- Add migrate-tag-prefixes.sh migration tool (#282)

  Adds a one-shot migration tool, `migrate-tag-prefixes.sh`, shipped inside the release-kit package. The tool creates additive annotated-tag aliases under release-kit's new unscoped-package-name prefix that point at the same commits as the previous directory-basename tags, bridging the gap so post-migration `getCommitsSinceTarget` calls can resolve prior releases.

- 🚨 **Breaking:** Add legacyTagPrefixes config field (#289)

  Replaces the v4 → v5 tag-prefix migration mechanism (tag aliasing via `migrate-tag-prefixes.sh`) with a declarative `legacyTagPrefixes` config field. release-kit now searches for both legacy and modern prefixes when generating changelogs.

  Adds a companion `release-kit show-tag-prefixes` CLI command that renders a per-workspace table of derived and declared legacy prefixes, flags cross-workspace collisions, and surfaces undeclared candidate prefixes with a copy-pasteable config snippet. `release-kit prepare` gains a one-line hint pointing operators to `show-tag-prefixes` when a workspace has no baseline tag but the repo contains candidate-shaped tags.

- 🚨 **Breaking:** Replace `legacyTagPrefixes` with `legacyIdentities` (#297)

  Replaces the per-workspace `legacyTagPrefixes: string[]` field with `legacyIdentities: LegacyIdentity[]`, a structured array of complete `(name, tagPrefix)` historical snapshots. Each legacy identity is now a self-consistent record of what a workspace used to be called and how its tags used to be prefixed, so a workspace that has been renamed (npm name change, tag-prefix change, or both) carries one entry per prior identity.

- Add `retiredPackages` repo-level config field (#299)

  Adds support for declaring packages that once lived in this repo but have been extracted or removed, so their historical tag prefixes (e.g., `preflight-v*` from the extracted `readyup` project) no longer surface as "Undeclared tag prefixes" in `release-kit show-tag-prefixes`. Declared retired packages are acknowledged as real history but never consulted for baseline lookup or changelog attribution — they complement `workspaces[].legacyIdentities`, which is used when a workspace still exists under a new identity.

- Add release-notes preview generator to `release-kit prepare` (#302)

  Adds the ability to generate release notes when running `release-kit prepare`. The `--with-release-notes` option enables the generation of per-workspace preview files so authors can verify release-note injection before publishing. Injected release notes are also now prefixed with a `## Release notes — v{version} ({date})` heading to add missing context to the README.

### 🐛 Bug fixes

- Derive monorepo tag prefix from unscoped `package.json` name (#278)

  Fixes a long-standing mismatch between a monorepo workspace's directory basename and its publishable package identity.

### ♻️ Refactoring

- 🚨 **Breaking:** Rename `component` to `workspace` in config API and internals (#296)

  Renames release-kit's per-workspace vocabulary from "component" to "workspace" throughout the public API, internal types, validation messages, CLI help, init templates, and documentation. Behavior is unchanged; only identifiers, error-message strings, scaffolded template text, and prose have been changed.

- 🚨 **Breaking:** Rename `node-monorepo-core` to `nmr-core` (#304)

  Renames the shared-utilities package from `@williamthorsen/node-monorepo-core` to `@williamthorsen/nmr-core`, aligning it with the repository's `nmr-*` naming convention. The package's functionality and version are unchanged; only the published name differs.

## 4.8.0 — 2026-04-17

### 🎉 Features

- Add `push` command for safe tag pushing (#243)

  Adds a `release-kit push` command that safely pushes the release commit and each tag individually, ensuring GitHub Actions fires a separate workflow run per tag. The command performs a `1 + N` push sequence: one branch push followed by one `git push --no-follow-tags origin <tag>` per resolved tag. Supports `--dry-run` (preview without pushing), `--only` (filter tags by package name), and `--tags-only` (skip the branch push).

### 🐛 Bug fixes

- Replace broad catch with `existsSync` guard in `detectRepoType` (#229)

  Fixes silent swallowing of unexpected filesystem errors in `detectRepoType`. Previously, errors like `EACCES` (permission denied) or `EMFILE` (too many open files) when reading `package.json` were caught and discarded, causing the function to silently return `'single-package'` instead of surfacing the problem.

## 4.7.0 — 2026-04-16

### 🎉 Features

- Support ## as synthetic ticket prefix in changelogs

  Commits prefixed with `##` are now included in changelogs without requiring a ticket ID. This supports ad-hoc changes made during interactive sessions where creating a ticket and PR adds undesired overhead.

## 4.6.0 — 2026-04-15

### 🎉 Features

- Guard `prepare` against dirty working tree (#188)

  Add a clean-working-tree check at the start of `prepareCommand` that exits with an error when `git status --porcelain` reports uncommitted changes. This prevents the double-bump problem where running `prepare` multiple times bumps the version each time from the already-bumped `package.json`.

  The check can be bypassed with `--no-git-checks` (`-n`) and is automatically skipped during `--dry-run`.

- Add sync-labels drift detection to release-kit readyup kit (#190)

  Adds readyup kit checks that detect when a consumer's sync-labels workflow or generated labels file has drifted from the current templates and presets. The `generate` command now embeds per-preset content hashes in the `labels.yaml` header, enabling hash-based staleness detection.

- Improve changelog formatting & add cliff config drift detection (#193)

  Improves changelog generation: cleanly indented commit bodies, stripped type prefixes, and no unticketed noise. Adds hash-based drift detection so the rdy kit warns when a consumer's local cliff config falls behind the current template. Fixes a latent bug where git-cliff rejected the bundled `.template` file extension.

- Generate release notes distinct from changelogs (#199)

  Adds structured changelog generation with audience tagging to the `release-kit` package, enabling GitHub Release creation and npm README injection with user-facing release notes filtered from developer-only sections. The existing CHANGELOG.md pipeline is unchanged; a new `.meta/changelog.json` artifact is generated in parallel during `release-kit prepare`, and consumed during `release-kit publish` to create GitHub Releases and inject release notes into the published package's README.

### ♻️ Refactoring

- Decouple GitHub Release creation and README injection from npm publish (#203)

  Makes GitHub Release creation available as a standalone CLI command (`release-kit github-release`) and removes README injection logic from the publish function. Non-published projects (applications, websites, internal tools) can now create GitHub Releases independently after `release-kit prepare`, and the inject/restore lifecycle is managed by the command layer rather than buried inside business logic.

### ⚙️ Tooling

- Enable automated publication to npm (#187)

  Prepares the repository for reliable tag-triggered npm publishing by adding missing package metadata, standardizing licensing, and introducing a readyup kit that validates publish readiness across all packages.

## 4.5.1 — 2026-04-10

### 🐛 Bug fixes

- Fix sync-labels init scaffolding output (#179)

  Fixes three issues in `release-kit sync-labels init` scaffolding output that cause immediate errors for consumers: adds missing workflow permissions, corrects config template indentation from 2 to 4 spaces, and switches YAML quoting from double to single quotes.

## 4.4.0 — 2026-04-04

### 🎉 Features

- Add --version flag to nmr and release-kit (#143)

  Adds `--version` / `-V` support to the `nmr` and `release-kit` CLIs, matching the existing `preflight` behavior. Moves the build-time version generation script to the shared `config/` directory so all three packages use a single `generateVersion.ts`.

- Detect and report missing build output in bin wrappers (#152)

  Adds try/catch with `ERR_MODULE_NOT_FOUND` detection to all six bin wrappers across `nmr`, `preflight`, and `release-kit`. Previously, five of the six wrappers used bare `import()` calls that produced cryptic unhandled rejections when `dist/` was missing, and `preflight`'s existing try/catch gave no actionable guidance.

### ♻️ Refactoring

- Extract deleteFileIfExists helper (#136)

  Replaces the duplicate `deleteTagsFile` and `deleteSummaryFile` functions in `createTags.ts` with a single parameterized `deleteFileIfExists(path)` utility. The new helper lives in its own module and is exported from the package barrel for reuse.

- Extract shared CLI argument-parsing utility into core (#151)

  Add a schema-driven `parseArgs` function to `@williamthorsen/node-monorepo-core` that handles boolean flags, string flags (both `--flag=value` and `--flag value`), short aliases, positional collection, the `--` delimiter, and unknown-flag errors. Migrate all CLI argument-parsing sites in preflight (3 sites) and release-kit (5 sites) to use it. A companion `translateParseError` helper normalizes internal error messages for consistent user-facing output.

### 📚 Documentation

- Refine README to match preflight documentation standard (#138)

  Restructures the release-kit README to match the documentation standard established by the preflight README (#114). Reorders sections to follow the cross-package convention, converts CLI flag listings from code blocks to tables, adds representative `prepare --dry-run` output to the quick start, and condenses ~90 lines of inline workflow YAML into a summary with an inputs table and trigger examples. Fixes several accuracy gaps found by verifying documentation against source.

## 4.0.0 — 2026-04-02

### 🎉 Features

- Rename reusable workflows to .reusable.yaml convention (#129)

  Renames all three reusable GitHub Actions workflow files from the inconsistent `-workflow.yaml`/bare `.yaml` convention to a uniform `.reusable.yaml` suffix. Updates all references across caller workflows, release-kit templates, tests, preflight collection, and documentation. Scaffolds the sync-labels caller workflow and labels file for this repo. Deletes superseded legacy files.

## 3.0.0 — 2026-03-29

### 🎉 Features

- 🚨 **Breaking:** Support conventional-commit format in commit parsing (#85)

  Adds support for the conventional commits format (`type(scope): description`) alongside the existing pipe-prefixed format (`scope|type: description`) in release-kit's commit parser. Renames `workspace` to `scope` throughout release-kit types, config, validation, and consumers.

- Add commit command for local release flow (#89)

  Adds a `release-kit commit` command that centralizes the release commit step between `prepare` and `tag`. The command reads tag names and a per-component commit summary from temporary files written by `prepare`, stages all changes, and creates a formatted commit. Two new utilities — `stripScope` and `buildReleaseSummary` — support building the commit body by stripping redundant scope indicators and formatting commits under their component headings. The CI workflow is simplified to use `release-kit commit` and `release-kit tag` instead of inline shell logic.

- Add CI publish workflow with OIDC trusted publishing (#90)

  Adds automated npm publication via a tag-push-triggered GitHub Actions workflow using OIDC trusted publishing. Extends `release-kit publish` with a `--provenance` flag and `release-kit init` with publish workflow scaffolding.

- Make --provenance opt-in to support private repos (#94)

  Adds a `provenance` boolean input (default `false`) to the reusable `publish-workflow.yaml` so private repos using OIDC trusted publishing no longer fail at publish time. The `--provenance` flag is only passed to `release-kit publish` when the caller sets `provenance: true`.

  Updates the scaffolded `publish.yaml` template to include `provenance: false` with an inline comment guiding public repos to opt in. Expand the `release-kit init` next-steps output with hints about the provenance setting and trusted publisher registration. Set `provenance: true` in this repo's own `publish.yaml` since it is public.

### 🐛 Bug fixes

- Pass tag pattern to git-cliff based on tagPrefix (#77)

  Fixes the issue that git-cliff was processing the entire commit history on every run instead of only commits since the last release.

  Constructs the pattern from `tagPrefix` at invocation time (e.g., `release-kit-v` → `release-kit-v[0-9].*`) and pass it via `--tag-pattern`, which overrides the config file default.

- Propagate version bumps to workspace dependents (#80)

  Restructures `releasePrepareMono` from a single-pass loop into a phased pipeline that automatically patch-bumps workspace dependents when a component is released. A reverse dependency graph is built from `workspace:` references in `dependencies` and `peerDependencies`, then BFS propagation walks upward from bumped components to their dependents. Propagated-only components receive synthetic changelog entries instead of git-cliff invocations.

## 2.3.2 — 2026-03-28

### 🐛 Bug fixes

- Prevent unparseable commits from being silently dropped (#76)

  Prevents `releasePrepareMono` and `releasePrepare` from silently skipping components whose commits have unparseable messages. Adds ticket-prefix stripping to `parseCommitMessage` (mirroring cliff.toml's `commit_preprocessors`), a patch-floor safety net when commits exist but none parse, and unparseable-commit reporting in `reportPrepare`.

## 2.3.0 — 2026-03-28

### 🎉 Features

- Add shared writeFileWithCheck utility and overwrite reporting (#66)

  Extracts three duplicated `writeIfAbsent` implementations and two duplicated terminal helper sets into shared utilities in `@williamthorsen/node-monorepo-core`, then migrates all consumers (`release-kit init`, `preflight init`, `sync-labels`) to use them. All init commands now report which files were created, overwritten, skipped, or failed — including when `--force` replaces existing files.

- Separate tag-write errors from release preparation errors (#67)

  When tag-file writing fails, the error message now reads "Error writing release tags:" instead of the misleading "Error preparing release:", which only appeared because both operations shared a single try/catch.

  Refactors `writeReleaseTags` to use the shared `writeFileWithCheck` utility from `@node-monorepo-tools/core` instead of raw `mkdirSync`/`writeFileSync`. The function now returns a structured `WriteResult` instead of throwing, and contains no `console` calls — all presentation moves to `runAndReport`.

### 🧪 Tests

- Add eligibility check failure and short-circuit tests (#63)

  Adds 4 unit tests to `initCommand.unit.test.ts` covering the remaining `checkEligibility` orchestration gaps: individual failure exit codes for `hasPackageJson` and `usesPnpm`, and short-circuit verification ensuring downstream checks are skipped when an earlier check fails.

- Add cliff.toml.template alignment test (#64)

  Adds a unit test that enforces bidirectional alignment between `DEFAULT_WORK_TYPES` and the bundled `cliff.toml.template` commit parsers. The test parses the TOML template using `smol-toml`, then verifies that every canonical type name and alias is matched by a parser with the correct group heading, and that every parser group maps to a known work type header.

- Add releasePrepare coverage for bumpOverride, tagPrefix, and dry-run tags (#65)

  Adds three unit tests to `releasePrepare.unit.test.ts` covering previously untested code paths: the `bumpOverride` bypass of commit-based bump detection, custom `tagPrefix` propagation into tags, and tag computation in dry-run mode.

## 2.2.0 — 2026-03-27

### 🎉 Features

- Add sync-labels command (#33)

  Add a `release-kit sync-labels` command group with three subcommands (`init`, `generate`, `sync`) for declarative GitHub label management in monorepos. Bundle a reusable GitHub Actions workflow and composable label presets with the release-kit package. Introduce a `findPackageRoot` utility to replace fragile hardcoded path resolutions across the codebase.

- Report up-to-date status for unchanged init files (#35)

  `release-kit init` now compares existing file content against the default before reporting status. When an existing file is identical to the default (after normalizing trailing whitespace), it reports `✅ (up to date)` instead of the misleading `⚠️ (already exists)`.

- Auto-detect Prettier for CHANGELOG formatting (#36)

  When `formatCommand` is not configured, release-kit now auto-detects whether the repo uses Prettier by checking for config files (`.prettierrc*`, `prettier.config.*`) or a `"prettier"` key in root `package.json`. If found, it defaults to `npx prettier --write` on generated files. If not found, formatting is skipped.

- Add tag-creation command (#40)

  Adds a `release-kit tag` CLI command that reads computed tag names from the `tmp/.release-tags` file produced by `prepare` and creates annotated git tags. The command supports `--dry-run` (preview without creating tags) and `--no-git-checks` (skip dirty working tree validation). The `createTags` function and its options type are exported for programmatic use.

- Add publish command (#42)

  Adds a `release-kit publish` subcommand that derives packages to publish from git tags on HEAD and delegates to the repo's detected package manager. Also cleans up the `.release-tags` file after tag creation.

- Remove tagPrefix customization from component config (#49)

  Removes the ability to customize `tagPrefix` per component, enforcing the deterministic `{dir}-v` convention universally. The internal `tagPrefix` property on `ComponentConfig` and `ReleaseConfig` is preserved — only the override/customization entry points are removed. Existing configs that still include `tagPrefix` now receive a clear deprecation error.

- Add styled terminal output to prepare command (#55)

  Adds ANSI formatting and emoji markers to the `release-kit prepare` command output. Progress chatter is dimmed, key results (version bumps, release tags, completion status) are highlighted with bold text and emoji, and monorepo components are separated by box-drawing section headers.

- Extract nmr CLI from core package (#61)

  Extracts all nmr CLI code from `packages/core` into a new `packages/nmr` package (`@williamthorsen/nmr`). Core is reduced to an empty shared-library shell ready for cross-cutting utilities. All internal references are rewired and the full build/test pipeline passes.

  Scopes: core, nmr

### ♻️ Refactoring

- Replace dist bin targets with thin wrapper scripts (#48)

  The `bin` entries in `packages/core` and `packages/release-kit` pointed directly into `dist/esm/`, causing `pnpm install` to emit "Failed to create bin" warnings in fresh worktrees where `dist/` does not yet exist. Each bin entry now points to a committed wrapper script in `bin/` that dynamically imports the real entry point. The `files` field in both packages includes `bin` so the wrappers are published.

- Separate presentation from logic in prepare workflow (#57)

  Extracts all `console.info` calls from the prepare workflow's logic functions (`bumpAllVersions`, `generateChangelogs`, `releasePrepare`, `releasePrepareMono`) into a dedicated `reportPrepare` formatter. Logic functions now return structured result types (`BumpResult`, `ComponentPrepareResult`, `PrepareResult`). The legacy `runReleasePrepare` entry point is retired, with its utilities absorbed into `prepareCommand`.

### 🧪 Tests

- Cover multi-changelogPaths and error paths (#44)

  Add three tests for previously untested code paths:

  - `releasePrepareMono`: component with two `changelogPaths` entries, asserting `git-cliff` is invoked once per path with the correct `--output` target.
  - `getCommitsSinceTarget`: `git describe` failure with a non-128 exit status propagates as a wrapped error instead of being swallowed.
  - `getCommitsSinceTarget`: `git log` failure is wrapped and re-thrown with the commit range in the message.

  Also adds a `findAllCliffOutputPaths()` test helper that collects the `--output` arg from every `git-cliff` mock call.

### ⚙️ Tooling

- Adopt nmr to run monorepo and workspace scripts (#38)

  Replaces the legacy workspace script runner and ~25 root `package.json` scripts with `nmr`, the monorepo's own context-aware script runner. Root scripts are reduced to 4 (`prepare`, `postinstall`, `ci`, `bootstrap`), packages use direct build commands for bootstrap, and release-kit declares tier-3 test overrides for its integration test configs.

## 2.1.0 — 2026-03-17

### 🎉 Features

- Migrate release-kit from toolbelt (#18)

  Migrates the complete `@williamthorsen/release-kit` package (v1.0.1) from `williamthorsen/toolbelt` into `packages/release-kit/`, adds shebang preservation to the shared esbuild plugin for CLI binaries, and sets up dogfooding infrastructure so this monorepo uses release-kit for its own releases.

- 🚨 **Breaking:** Slim down release workflow by removing unnecessary pnpm install (#21)

  Make release-kit self-contained by invoking git-cliff via `npx --yes` instead of requiring it on PATH, and by appending modified file paths to the format command so lightweight formatters like `npx prettier --write` work without a full `pnpm install`. Update init templates, README, and consuming repo config/workflow to reference workflow v3.

- Add --force flag to release-kit prepare (#25)

  Add a `--force` flag to `release-kit prepare` that bypasses the "no commits since last tag" check in monorepo mode, allowing version bumping and changelog generation to proceed even when no new commits are found since the last release tag. The flag requires `--bump` since there are no commits to infer bump type from. The local release workflow gains a `force` boolean input for future use.

- 🚨 **Breaking:** Move reusable release workflow into repo (#26)

  Moves the reusable release workflow from `williamthorsen/.github` into this repo as `release-workflow.yaml`, stripping all pnpm-related steps since release-kit now runs git-cliff and prettier via `npx` internally. Updates this repo's caller workflow to use a relative path and update init templates to reference the new location. Establishes a naming convention (`{name}-workflow.yaml` for reusable, `{name}.yaml` for callers) and independent versioning strategy (`{name}-workflow-v{major}` tags), documented in `.github/workflows/README.md`.

- Allow git-cliff to be used without config (#31)

  Adds a `resolveCliffConfigPath()` function that searches for a git-cliff config in a 4-step cascade (explicit path → `.config/git-cliff.toml` → `cliff.toml` → bundled `cliff.toml.template`), eliminating the requirement for consuming repos to maintain a cliff config copy. Restructures the `init` command to scaffold only the workflow file by default, with new `--with-config` and `--force` flags. Moves `.release-tags` from `/tmp/release-kit/` to project-local `tmp/` for predictable behavior in local runs.

### ♻️ Refactoring

- Clean up release-kit post-migration issues (#19)

  Addresses five code quality issues and a test coverage gap identified during the release-kit migration (#5). Extracts a duplicated `isRecord` type guard into a shared module, eliminates a double-read in `bumpAllVersions`, improves error handling in `usesPnpm` by replacing a silent catch with a structured error boundary, removes an unreachable `'feature'` pattern from version defaults, and adds an integration test for scaffold template path resolution.

## 1.0.1 — 2026-03-14

### 🎉 Features

- Migrate release-kit from toolbelt (#18)

  Migrates the complete `@williamthorsen/release-kit` package (v1.0.1) from `williamthorsen/toolbelt` into `packages/release-kit/`, adds shebang preservation to the shared esbuild plugin for CLI binaries, and sets up dogfooding infrastructure so this monorepo uses release-kit for its own releases.

<!-- Generated by release-kit. Do not edit this file. Use .meta/changelog-overrides.json to override entries. -->
