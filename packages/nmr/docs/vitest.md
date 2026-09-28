# Shared Vitest config

The Vitest config that `@williamthorsen/nmr/vitest` publishes: its test tiers and the commands that select them, the conventions check, what the factory supplies, and how to customize and share it.

The [README](../README.md#shared-vitest-config) shows the one-line config file.

`vitest` is a peer dependency (`>=4.0.0 <5`), declared optional; the consuming repo provides it, and repos that never import this subpath are unaffected. `vite` is an optional peer as well (`>=8.0.0 <9`), required only by the [`tsconfigPaths` setting](#resolving-through-tsconfig-paths); a repo that declares a `vite` of its own below that range sees an unmet-peer warning whether or not it sets the flag.

## Test tiers

The config declares four projects, an ordered ladder named for the furthest thing that a test reaches:

| Project     | Matches                                     | Reaches                                              |
| ----------- | ------------------------------------------- | ---------------------------------------------------- |
| `unit`      | every test file that the others don't claim | nothing outside the package's own dependency closure |
| `tool`      | `*.tool.test.{ts,tsx}`                      | a program that the environment must supply           |
| `localhost` | `*.localhost.test.{ts,tsx}`                 | a service running on this machine                    |
| `remote`    | `*.remote.test.{ts,tsx}`                    | a machine that isn't this one                        |

All four match only under a `__tests__` directory.

**A tier names what a test reaches, never how it invokes it.** A test driving a compiler through its JavaScript API is `tool`, exactly as one spawning the compiler binary is; whether a program ships as a library or an executable is an accident of packaging, not a property of the test. A package's `peerDependencies`, plus whatever binaries it spawns, are a good statement of where its `tool` boundary is: A bundled dependency is inside the package's own closure and is always present, so reaching one is `unit`.

**A tier is not a statement about preconditions.** A `unit` test may still need something set up before it runs: a build, a generated fixture, a seeded file. It is `unit` because it reaches nothing beyond the test process _while running_. The filesystem belongs to `unit` for the same reason the tiers exist: They gate on what must be available, and the filesystem always is.

**Every test file names its tier**, in the form `<subject>[.<aspect>].<tier>.test.ts`. Only the segment immediately before `.test.` selects a project, so an earlier one is free for documentation: `resolveConfig.packaged.unit.test.ts` reads as a companion to `resolveConfig.unit.test.ts` and still names `unit`.

Because `unit` is defined by subtracting the tiers rather than by an allow-list of infixes, a file such as `parser.smoke.test.ts` runs under `unit` instead of being silently dropped. That is a safety net, not a licence to omit the tier: A file whose tier segment is missing or misspelt runs under `unit` and reports success. Until the repo declares the [conventions check](#gating-the-test-file-conventions), a test run cannot distinguish that file from a conformant one. In a repo that has not, [nmr's readyup kit](../README.md#conformance-checks) reports those files.

`localhost` and `remote` do not have a test script of their own. They are declared anyway, so that a `*.remote.test.ts` file cannot fall into `unit` and run in the default gate unnoticed.

Every tier above `unit` has a 30-second `testTimeout` and `hookTimeout`, whereas `unit` keeps Vitest's defaults of 5 and 10 seconds. A tier test waits on something it doesn't control, and coverage instrumentation multiplies that wait, so the defaults turn a green suite flaky the moment `nmr test:coverage` collects it. Both budgets move together because a tier that scaffolds in `beforeAll` moves that wait out from under `testTimeout` entirely, and raising the test budget alone never affects it. `unit` keeps the tight budgets, which is what makes a hung unit test fail fast.

To raise a budget for one tier alone, use the `tiers` seam below. The `project` seam merges over both budgets as well, but like every option passed through it the value applies to all four projects at once -- raising a tier's budget raises `unit`'s with it. To raise the timeout for a single file rather than a whole tier, pass a timeout to the individual test or hook, which stays the narrower tool.

### Test selections

Select the tiers at run time with `--project`, which unions when repeated and accepts negation.

Every package resolves the same six test commands. Nothing is detected on disk: The commands select [Vitest projects](#shared-vitest-config), so a package separates its tool-tier tests by naming them `*.tool.test.ts`, not by adding extra config files.

| To run                                        | Command     |
| --------------------------------------------- | ----------- |
| Everything that runs on a bare install        | `test`      |
| The fastest tier alone                        | `test:unit` |
| Tests reaching a program alone                | `test:tool` |
| Every tier, including those needing a service | `test:all`  |

`test` names the tiers that it runs rather than negating the ones that it skips, so a tier added in a later release is opt-in rather than joining the default run on arrival. It covers `unit` and `tool`, the two that need nothing beyond a checkout and an install; `localhost` and `remote` are reached only through `test:all` or an explicit `--project`.

`test:coverage` and `test:watch` are the same selection as `test` in a different mode. nmr does not define `test:tool --coverage` equivalents, because they are not needed: Everything after a command name is forwarded untouched, and `nmr test:tool --coverage` already works.

To narrow to a single project, go through `test:all`: `nmr test:all --project remote`. Narrowing through `test` does not work, because a second `--project` widens the selection rather than restricting it.

A run that does not collect any test files passes. That is what lets `nmr test:tool` fan out across a monorepo in which most packages do not have any tool-tier tests, and it means a package without any tests at all does not need a `"test": ""` override.

The root registry defines the same six names, so a command means the same thing from the monorepo root as from inside a package. Each fans out to root-level files and every workspace package.

`test:coverage` chains `root:test` rather than a `root:test:coverage`, because the root config does not report any coverage of its own; packages cover their own sources.

`test:watch` is the exception to the fan-out shape, and deliberately omits `--config`: Bare `vitest` at the monorepo root resolves the root `vitest.config.ts`, whose projects then cover the whole tree in one process. A chain like the others would never advance past its first watcher. To watch root-level files alone, run `nmr root:test --watch`.

## Gating the test-file conventions

Both halves of the convention are silent on their own: An untiered file runs under the residual `unit` and passes, and a file outside `__tests__` is collected by nothing at all. `@williamthorsen/nmr/tests` exports a check that reports both, which a repo declares from a one-line test of its own:

```ts
// __tests__/test-file-conventions.tool.test.ts
import { checkTestFileConventions } from '@williamthorsen/nmr/tests';

checkTestFileConventions();
```

It declares one suite with an assertion per half, each stating the remedy that fixes it: the four tier names and the rename form, or the `__tests__` directory in which the file belongs. The guard names its own tier like any other test file, so a misnamed guard reports itself. That tier is `tool`, because the check asks git which paths it ignores.

A repo linting with `vitest/require-hook` needs a disable directive on that call, which the rule reads as setup work, whereas it declares the suite:

```ts
// eslint-disable-next-line vitest/require-hook -- the call declares the suite, whereas the rule reads it as setup work.
checkTestFileConventions();
```

Because the sweep starts at the monorepo root rather than at the directory that Vitest supplies, one call covers the whole repo from whichever package the run began in. `rootDir` overrides that, for a check pointed at a tree other than the repo's own.

The check is exported rather than run by nmr as a step, because nothing that nmr runs covers the whole tree: `nmr test` fans out per package, and a direct `vitest` invocation does not run any nmr script at all. A test that the repo owns also lets the repo scope what the sweep covers.

`excludedBasenames` names directory basenames for the sweep to prune at any depth, additive to the ones that nmr always prunes:

```ts
checkTestFileConventions({ excludedBasenames: ['cypress', 'generated'] });
```

**Pass the same array to [`testCollectionExclude`](#what-the-config-excludes).** The two describe one scope, and naming a directory in only one is a defect in either direction. When the directory is pruned from the sweep alone, its test files still run and still report nothing, which is the silence that this check exists to end. When it is excluded from collection alone, the sweep reports files that a consumer does not need to act on.

**Paths that git ignores are out of scope for both.** The sweep skips every untracked path that git ignores under the swept root, and the shared configs exclude the same paths from collection, so local build output such as a stale `.netlify/` directory is neither reported nor run. Git decides what is ignored: A tracked file stays in scope even when it matches an ignore pattern. Outside a git repository, or when git cannot run, nothing counts as ignored and only the named directories are pruned. A generated directory that the repo's `.gitignore` already covers therefore does not need an entry in either list.

Expect the first run to fail in a repo that has never gated this. Vitest 4 excludes only `node_modules` and `.git` by default, so a `__tests__` tree under a generated or vendored directory that git tracks is collected and runs today; naming that directory in both lists is the fix, rather than widening what nmr prunes for everyone.

In a repo that has not declared the check, [nmr's readyup kit](../README.md#conformance-checks) reports both halves and warns that the check is missing. Once a test file under `__tests__` imports it, the kit skips both reports and names that file as the reason. Only the check reads the repo's `excludedBasenames`, and a kit report beside it could only repeat its findings or name a directory that the repo has pruned.

## What the config supplies

Two settings that a workspace test runner needs almost universally are part of what the factory produces, so a config file declares neither:

- **A package outside `node_modules` resolves from source.** Because a cross-package import resolves to the dependency's `.ts` rather than its `dist/`, through the `source` condition declared by its `exports` map, a suite runs without a prior build. The reach is what the boundary names: a workspace package, or one linked into the repo from elsewhere, whose real path is outside every `node_modules`. A package that does not declare a `source` condition is unaffected, and so is every package under `node_modules`, whatever its `exports` map declares.
- **Git subprocesses are isolated.** Every project loads a setup file that points `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at the null device, sets `GIT_CONFIG_NOSYSTEM` and `GIT_ATTR_NOSYSTEM`, and injects `core.excludesFile` and `core.attributesFile` through `GIT_CONFIG_COUNT` and its key/value pairs, so a test that spawns `git` reads neither the developer's identity, nor a signing config that can block on a passphrase, nor their global ignore rules and attributes. Those last two need a step of their own: Because neither path is config-derived, git resolves each from `$XDG_CONFIG_HOME/git/`, or from `~/.config/git/` when that variable is unset, whatever the config variables say. `GIT_CONFIG_GLOBAL` already replaces `$XDG_CONFIG_HOME/git/config`; those two are the rest of what that directory supplies. The system attributes file at `$(prefix)/etc/gitattributes` is not named by any config variable at all, which is what `GIT_ATTR_NOSYSTEM` covers. Redirecting `XDG_CONFIG_HOME` would cover the per-user pair as well, but the setup file does not redirect it, because other tools spawned by a test read that variable for configuration of their own: pnpm fails to start under `XDG_CONFIG_HOME=/dev/null`. An injected key outranks repository-local config, so a repository setting its own `core.excludesFile` is overridden under the isolation; a test needing its own value passes it on the invocation as `git -c core.excludesFile=...`, which outranks the injection. The setup file leads each project's `setupFiles`, ahead of every entry that the layers add, because a shared setup establishes the environment in which the rest run.

Both defaults exist because omitting either is silent rather than loud: The tiers still exist and the suite still runs green, testing `dist/` and the developer's git identity instead. Turn either off through its own option, which folds across layers like any other, the last layer to declare it winning:

```ts
export default defineVitestConfig({ shouldIsolateGit: false, shouldResolveFromSource: false });
```

`shouldResolveFromSource: false` is for a repo whose own packages declare a `source` condition that it does not want in tests; `shouldIsolateGit: false` is for a suite meant to read the developer's own git configuration.

**Vite replaces its condition defaults rather than extending them.** A config writing `conditions: ['my-condition']` by hand therefore drops `module`, so a dependency exposing a `module` entry falls through to whatever its `exports` lists next. A replaced list still resolves `node` and `development` under Vitest, which is why nothing in a test run reports the loss. Because the factory emits Vite's defaults for each environment, whichever way `shouldResolveFromSource` is set, a layer adding a condition extends a complete list rather than replacing one.

**The condition is resolved by a plugin rather than named as a Vite condition, which is what bounds its reach.** Vitest turns `ssr.resolve.conditions` into `--conditions` flags on the worker process, where Node applies every entry to each package that it resolves natively. Node refuses to strip types from a file under `node_modules`, so a `source` condition reaching that far makes any dependency declaring a TypeScript entry fail to load, the dependency of a dependency included. Resolving inside Vite lets nmr decide the condition's reach, and leaves a published package to resolve through its other conditions however it declares `source`.

**The boundary is Vite's resolution, not the package's role.** Because Node does not apply the `source` condition, a workspace package that an externalized dependency imports resolves through Node to its build output. Nothing else in a suite resolves that way.

## Resolving through tsconfig paths

A third resolution setting exists alongside those two, and this one is off. `tsconfigPaths: true` emits Vite's `resolve.tsconfigPaths`, so a test resolves an aliased specifier through the `paths` that its `tsconfig.json` declares, the way `tsc` does:

```ts
export default defineVitestConfig({ tsconfigPaths: true });
```

It folds across layers like the other two, the last layer to declare it winning. It does not need an `ssr` counterpart the way a condition does: Because Vite keeps this setting outside its per-environment resolve options, the single key applies to the environment through which a test's own imports resolve.

**It is an opt-in because its silent direction is the reverse of the two defaults'.** Leaving it off fails loudly, with an unresolved import naming the specifier. Turning it on is the silent direction, for a repo that declares `paths` for `tsc` alone: A specifier that resolved through a package's `exports` starts resolving through the alias instead, and nothing in the run reports the switch. A repo that does not declare `paths` is unaffected either way.

**It requires Vite 8**, the version that introduced `resolve.tsconfigPaths`. nmr declares `vite` as an optional peer at `>=8.0.0 <9`, so a repo that declares a stale `vite` of its own sees a warning at install time. That check does not apply to a repo whose only Vite comes in through Vitest's own dependency, and Vitest 4 accepts Vite 6 and 7: On those, the emitted key does nothing and the aliased import fails exactly as it would with the flag off.

## Customizing by scope

Vitest applies some options at the root of a `projects` config and others per project, and placing one at the wrong level is silent rather than loud. The factory therefore takes separate override surfaces instead of one merged config:

```ts
export default defineVitestConfig({
  // Vite-level options, plus the test options Vitest honours only at the root.
  root: { ssr: { resolve: { conditions: ['my-condition'] } } },
  // Applied to every project.
  project: { setupFiles: ['./vitest.setup.ts'] },
  // Applied to one tier, after the `project` block above.
  tiers: { tool: { testTimeout: 120_000 } },
});
```

`root` is typed to accept only the options that work at the root, so writing a per-project option there is a compile error rather than a setting that never runs. Because every surface merges into the generated config rather than replacing it, overriding one coverage field leaves the rest intact.

`tiers` is keyed by tier name and applies to all four, `unit` included. A key that does not name a tier throws and names the valid ones: Ignoring it would leave the suite green on the budget that the key failed to change, which nothing in the run reports. A tier target sets only the keys that it names, so raising `testTimeout` alone leaves that tier's `hookTimeout` at 30 seconds.

Arrays concatenate rather than replace. `exclude` and `setupFiles` therefore add to what the config already declares, and a surface can neither narrow `include` nor drop a default exclusion. Adding an `include` pattern through `project` widens all four projects at once: A file matching it is collected by each and runs four times.

`resolve.conditions` concatenates too, onto the Vite defaults that the factory already emits, but layer order does not matter there: Vite consumes conditions as a set, and which one wins is decided by the key order of the consumed package's own `exports`. A later layer can add a condition and can never remove or outrank one that an earlier layer contributed. Every entry also reaches Node, which resolves each package reached by a test's imports under `node_modules`, so a condition added here is one that the package's `exports` map may answer. `resolve.alias` is the one key that merges override-first: A later alias takes precedence over an earlier one.

**A condition for the tests' own resolution goes under `ssr`.** Because `resolve` is per-environment and Vitest resolves a test's imports through the server environment, `root: { ssr: { resolve: { conditions: ['my-condition'] } } }` is the seam that applies to them. A top-level `root: { resolve: { conditions: [...] } }` entry applies to the client environment, which only browser-mode tests resolve through; it composes into that array and never reports that a node test did not see it. `resolve.alias` is not per-environment, so a top-level alias applies to both.

## Sharing options across config files

Vitest resolves one config per run: A package that adds its own `vitest.config.ts` stops seeing the repo's root config entirely -- not the one setting that it meant to change, all of them. Pass the shared settings as a layer instead:

```ts
// vitest.shared.ts
import { fileURLToPath } from 'node:url';

import type { VitestConfigOptions } from '@williamthorsen/nmr/vitest';

export const shared: VitestConfigOptions = {
  root: { resolve: { alias: { '~': fileURLToPath(new URL('.', import.meta.url)) } } },
  project: { setupFiles: [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url))] },
};
```

```ts
// packages/web/vitest.config.ts
import { defineVitestConfig } from '@williamthorsen/nmr/vitest';

import { shared } from '../../vitest.shared.ts';

export default defineVitestConfig(shared, { project: { environment: 'jsdom' } });
```

Both factories fold any number of layers left to right: A later layer wins on a scalar, arrays concatenate in layer order, and an `undefined` layer is skipped, which lets `defineVitestConfig(shared, isCI ? ciLayer : undefined)` compose without a spread. `defineRootVitestConfig` takes the same layers, with `monorepoRoot` on the last one -- the config file's own, the only place `import.meta.dirname` names this repo.

Order matters for `setupFiles`, because a shared setup file establishes the environment in which the package's own then runs. A later layer's `project` block likewise wins over an earlier layer's `tiers` target: The nearer config is the more deliberate.

**A package's own `vite.config.ts` also counts as that one config.** Vitest searches for a config by ascending from the run root and stopping at the first directory containing any of `vitest.config.*` or `vite.config.*`, so a package with only a Vite config ends the search there and never reaches the root config. Within a directory `vitest.config.*` is tried first, which makes the fix a Vitest config beside the Vite one, calling `defineVitestConfig()` as any other package config does. Without it the package does not declare any projects, and every tier-selecting command fails with `No projects matched the filter`, `nmr ci` among them. [nmr's readyup kit](../README.md#conformance-checks) reports a package in that state.

**A path in a shared layer must be absolute.** Vitest resolves `setupFiles` against each project's own root, not against the module that declared the path, so a bare `'./vitest.setup.ts'` in a shared module names a different file in every package that consumes it -- and a package that happens to own a file by that name loads the wrong one instead of failing. The co-located form stays correct in a config file that declares the path directly.

**Do not merge two returned configs.** `mergeConfig(defineVitestConfig(), defineVitestConfig(mine))` looks like the idiomatic recovery and fails at startup: Both sides declare the same four project names, which Vitest rejects with `Project name "unit" ... is not unique`. Layers merge the factory's inputs instead, which is why they yield four projects however many fold.

A config file that omits the shared layer still loses those settings, silently -- Vitest's own resolution contract, not something the factory can intercept. Guard it with a test that fails when a package's suite goes missing, which also catches a shared `exclude` pattern that excludes one package's tests. Source resolution and git isolation do not need such a guard: The factory supplies both, so a config file cannot omit them by forgetting a layer.

## What the config excludes

Collection skips `**/node_modules/**`, `**/.git/**`, `**/coverage/**`, and `**/dist/**`, and every untracked path that git ignores: `defineVitestConfig` asks git about the working directory, which is Vitest's default root, and `defineRootVitestConfig` about `monorepoRoot`. Each ignored path becomes a glob anchored to that root, and a tracked file matching an ignore pattern is still collected. These are the paths that the [conventions check](#gating-the-test-file-conventions) skips; outside a git repository, neither skips anything on git's account. Coverage skips `**/__{fixtures,mocks,tests}__/**`, `**/index.ts`, and `**/*.d.ts`.

`testCollectionExclude` adds to the collection list. It takes directory basenames rather than globs, matched at any depth, so the same array serves the [conventions check](#gating-the-test-file-conventions):

```ts
export default defineVitestConfig({ testCollectionExclude: ['cypress', 'generated'] });
```

Every layer's entries are concatenated, and a name that the shared config already prunes is emitted once. A repo needing a glob rather than a directory name has the `project` seam's own `exclude`.

Because both seams concatenate, a consumer can add an exclusion but never remove one. A pattern therefore belongs in these lists only if it prevents a _silent_ failure, one that a consumer cannot self-diagnose. A visible failure, such as a stray file at 0% in the coverage report, is left to the consumer's own `project` seam.

Excluding build output from collection is the clearest case. A build that copies `.ts` sources rather than compiling them puts a second copy of the suite under `dist/`, where it is collected and passes green against stale code, and nothing in the run says so. (`nmr build` emits only `.js` and `.d.ts`, neither of which the include matches, so an nmr-built package was never exposed.) `dist/` is deliberately absent from the coverage list, because build output in a coverage report shows up as a diagnosable 0% entry.

### Where to put fixtures

Because a `__fixtures__/` directory is excluded from coverage at any depth, fixture data stops counting against a package's numbers whether or not a test imports it.

Placing it outside `__tests__/` settles a second problem: Anything named `*.test.{ts,tsx}` under `__tests__/` is collected and run, whatever it contains. A fixture with that name becomes a failing test. `src/__fixtures__/` resolves both halves; `src/__tests__/__fixtures__/` resolves the coverage half alone.

The collection exclusions do not name fixtures, and that asymmetry is intentional. A coverage exclusion cannot hide a real test, whereas a collection exclusion can; since it could not be removed, a consumer who legitimately keeps a test under `__fixtures__/` would not have any recourse.

## Root-scoped tests

A monorepo's own root-level tests need a second config, because the package config is found by walking up from a package directory:

```ts
// vitest.root.config.ts
import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });
```

This variant reads `pnpm-workspace.yaml` and excludes every workspace package from all four projects, so a root run covers only root-level files. It does not report any coverage of its own; packages cover their own sources.

`monorepoRoot` is required, and because the config is at the monorepo root, it is always `import.meta.dirname`. Stating the root rather than searching for it makes the exclusions describe this repo: A search from the working directory would resolve whichever monorepo the run started in, and every project is then pinned to that one. `defineRootVitestConfig` throws for a directory that does not contain `pnpm-workspace.yaml`, naming the directory.
