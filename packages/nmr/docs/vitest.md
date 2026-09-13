# Shared Vitest config

The Vitest config that `@williamthorsen/nmr/vitest` publishes: its test tiers and the commands that select them, the conventions check, what the factory supplies, and how to customize and share it.

The [README](../README.md#shared-vitest-config) shows the one-line config file.

`vitest` is a peer dependency (`>=4.0.0 <5`), declared optional — the consuming repo provides it, and repos that never import this subpath are unaffected. `vite` is an optional peer as well (`>=8.0.0 <9`), required only by the [`tsconfigPaths` setting](#resolving-through-tsconfig-paths); a repo that declares a `vite` of its own below that range sees an unmet-peer warning whether or not it sets the flag.

## Test tiers

The config declares four projects, an ordered ladder named for the furthest thing a test reaches:

| Project     | Matches                                | Reaches                                              |
| ----------- | -------------------------------------- | ---------------------------------------------------- |
| `unit`      | every test file the others don't claim | nothing outside the package's own dependency closure |
| `tool`      | `*.tool.test.{ts,tsx}`                 | a program the environment must supply                |
| `localhost` | `*.localhost.test.{ts,tsx}`            | a service running on this machine                    |
| `remote`    | `*.remote.test.{ts,tsx}`               | a machine that isn't this one                        |

All four match only under a `__tests__` directory.

**A tier names what a test reaches, never how it invokes it.** A test driving a compiler through its JavaScript API is `tool`, exactly as one spawning the compiler binary is; whether a program ships as a library or an executable is an accident of packaging, not a property of the test. A package's `peerDependencies`, plus whatever binaries it spawns, are a good statement of where its `tool` boundary sits: a bundled dependency ships inside the package's own closure and is always present, so reaching one is `unit`.

**A tier is not a statement about preconditions.** A `unit` test may still need something set up before it runs: a build, a generated fixture, a seeded file. What makes it `unit` is that it reaches nothing beyond the test process _while running_. The filesystem sits in `unit` for the same reason the tiers exist: they gate on what must be available, and the filesystem always is.

**Every test file names its tier**, in the form `<subject>[.<aspect>].<tier>.test.ts`. Only the segment immediately before `.test.` selects a project, so an earlier one is free for documentation: `resolveConfig.packaged.unit.test.ts` reads as a companion to `resolveConfig.unit.test.ts` and still names `unit`.

`unit` is defined by subtracting the tiers rather than by an allow-list of infixes, so a file such as `parser.smoke.test.ts` runs under `unit` instead of being silently dropped. That is a safety net, not a licence to omit the tier: a file whose tier segment is missing or misspelt runs under `unit` and reports success, so no test run distinguishes it from a conformant one until the repo declares the [conventions check](#gating-the-test-file-conventions). In a repo that has not, [nmr's readyup kit](../README.md#conformance-checks) is what reports those files.

`localhost` and `remote` have no test script of their own. They are declared anyway, so that a `*.remote.test.ts` file cannot fall into `unit` and run in the default gate unnoticed.

Every tier above `unit` carries a 30-second `testTimeout` and `hookTimeout`, where `unit` keeps Vitest's defaults of 5 and 10 seconds. A tier test waits on something it doesn't control, and coverage instrumentation multiplies that wait, so the defaults turn a green suite flaky the moment `nmr test:coverage` collects it. Both budgets move together because a tier that scaffolds in `beforeAll` moves that wait out from under `testTimeout` entirely, where raising the test budget alone never reaches it. `unit` keeps the tight budgets, which is what makes a hung unit test fail fast.

To raise a budget for one tier and no other, use the `tiers` seam below. The `project` seam merges over both budgets as well, but like every option passed through it the value reaches all four projects at once -- raising a tier's budget raises `unit`'s with it. To lift the ceiling for a single file rather than a whole tier, pass a timeout to the individual test or hook, which stays the narrower tool.

### Test selections

Select the tiers at run time with `--project`, which unions when repeated and accepts negation.

Every package resolves the same six test commands. Nothing is detected on disk: the commands select [Vitest projects](#shared-vitest-config), so a package separates its tool-tier tests by naming them `*.tool.test.ts`, not by carrying extra config files.

| To run                                        | Command     |
| --------------------------------------------- | ----------- |
| Everything that runs on a bare install        | `test`      |
| The fastest tier alone                        | `test:unit` |
| Tests reaching a program alone                | `test:tool` |
| Every tier, including those needing a service | `test:all`  |

`test` names the tiers it runs rather than negating the ones it skips, so a tier added in a later release is opt-in rather than joining the default run on arrival. It covers `unit` and `tool`, the two that need nothing beyond a checkout and an install; `localhost` and `remote` are reached only through `test:all` or an explicit `--project`.

`test:coverage` and `test:watch` are the same selection as `test` in a different mode. There are no `test:tool --coverage` equivalents because none are needed: everything after a command name is forwarded untouched, so `nmr test:tool --coverage` already works.

To narrow to a single project, go through `test:all`: `nmr test:all --project remote`. Narrowing through `test` does not work, because a second `--project` widens the selection rather than restricting it.

A run that collects no test files passes. That is what lets `nmr test:tool` fan out across a monorepo in which most packages hold no tool-tier tests, and it means a package with no tests at all needs no `"test": ""` override.

The root registry carries the same six names, so a command means the same thing from the monorepo root as from inside a package. Each fans out to root-level files and every workspace package.

`test:coverage` chains `root:test` rather than a `root:test:coverage`, because the root config reports no coverage of its own; packages cover their own sources.

`test:watch` is the exception to the fan-out shape, and deliberately omits `--config`: bare `vitest` at the monorepo root resolves the root `vitest.config.ts`, whose projects then cover the whole tree in one process. A chain like the others would never advance past its first watcher. To watch root-level files alone, run `nmr root:test --watch`.

## Gating the test-file conventions

Both halves of the convention are silent on their own: an untiered file runs under the residual `unit` and passes, and a file outside `__tests__` is collected by nothing at all. `@williamthorsen/nmr/tests` exports a check that reports both, which a repo declares from a one-line test of its own:

```ts
// __tests__/test-file-conventions.unit.test.ts
import { checkTestFileConventions } from '@williamthorsen/nmr/tests';

checkTestFileConventions();
```

It declares one suite with an assertion per half, each carrying the remedy that fixes it: the four tier names and the rename form, or the `__tests__` directory the file belongs in. The guard names its own tier like any other test file, so a misnamed guard reports itself.

A repo linting with `vitest/require-hook` needs a disable directive on that call, which the rule reads as setup work where it declares the suite:

```ts
// eslint-disable-next-line vitest/require-hook -- the call declares the suite, where the rule reads it as setup work.
checkTestFileConventions();
```

The sweep starts at the monorepo root rather than at the directory Vitest supplies, so one call covers the whole repo from whichever package the run began in. `rootDir` overrides that, for a check pointed at a tree other than the repo's own.

An exported check rather than a step nmr runs for you, because nothing nmr runs reaches the whole tree: `nmr test` fans out per package, and a direct `vitest` invocation runs no nmr script at all. A test the repo owns also lets the repo scope what the sweep covers.

`exclude` names directory basenames the sweep prunes at any depth, additive to the ones nmr always prunes:

```ts
checkTestFileConventions({ exclude: ['cypress', 'generated'] });
```

**Pass the same array to [`testCollectionExclude`](#what-the-config-excludes).** The two describe one scope, and naming a directory in only one is a defect in either direction. Pruned from the sweep alone, the directory's test files still run and still report nothing, which is the silence this check exists to end. Excluded from collection alone, the sweep reports files a consumer has no reason to act on.

Expect the first run to fail in a repo that has never gated this. Vitest 4 excludes only `node_modules` and `.git` by default, so a `__tests__` tree under a generated or vendored directory is collected and runs today; naming that directory in both lists is the fix, rather than widening what nmr prunes for everyone.

## What the config supplies

Two settings a workspace test runner needs almost universally are part of what the factory produces, so a config file declares neither:

- **A package outside `node_modules` resolves from source.** A cross-package import reaches the dependency's `.ts` rather than its `dist/`, through the `source` condition declared by its `exports` map, so a suite runs without a prior build. The reach is what the boundary names: a workspace package, or one linked into the repo from elsewhere, whose real path sits outside every `node_modules`. A package declaring no such condition is unaffected, and so is every package under `node_modules`, whatever its `exports` map declares.
- **Git subprocesses are isolated.** Every project loads a setup file that points `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at the null device, sets `GIT_CONFIG_NOSYSTEM` and `GIT_ATTR_NOSYSTEM`, and injects `core.excludesFile` and `core.attributesFile` through `GIT_CONFIG_COUNT` and its key/value pairs, so a test that spawns `git` reads neither the developer's identity, nor a signing config that can block on a passphrase, nor their global ignore rules and attributes. Those last two need a step of their own: neither path is config-derived, so git resolves each from `$XDG_CONFIG_HOME/git/`, or from `~/.config/git/` where that variable is unset, whatever the config variables say. `GIT_CONFIG_GLOBAL` already replaces `$XDG_CONFIG_HOME/git/config`, so those two are the rest of what that directory supplies; the system attributes file at `$(prefix)/etc/gitattributes` is reached by no config variable at all, which is what `GIT_ATTR_NOSYSTEM` covers. Redirecting `XDG_CONFIG_HOME` would reach the per-user pair as well, and is not used, because other tools spawned by a test read that variable for configuration of their own: pnpm fails to start under `XDG_CONFIG_HOME=/dev/null`. An injected key outranks repository-local config, so a repository setting its own `core.excludesFile` is overridden under the isolation; a test needing its own value passes it on the invocation as `git -c core.excludesFile=...`, which outranks the injection. The setup file leads each project's `setupFiles`, ahead of every entry the layers add, because a shared setup establishes the environment the rest run in.

Both defaults exist because omitting either is silent rather than loud: the tiers still exist and the suite still runs green, testing `dist/` and the developer's git identity instead. Turn either off through its own option, which folds across layers like any other, the last layer to declare it winning:

```ts
export default defineVitestConfig({ isolateGit: false, resolveFromSource: false });
```

`resolveFromSource: false` is for a repo whose own packages declare a `source` condition that it does not want in tests; `isolateGit: false` is for a suite meant to read the developer's own git configuration.

**Vite replaces its condition defaults rather than extending them.** A config writing `conditions: ['my-condition']` by hand therefore drops `module`, so a dependency exposing a `module` entry falls through to whatever its `exports` lists next. A replaced list still resolves `node` and `development` under Vitest, which is why nothing in a test run reports the loss. The factory emits Vite's defaults for each environment, whichever way `resolveFromSource` is set, so a layer adding a condition extends a complete list rather than replacing one.

**The condition is resolved by a plugin rather than named as a Vite condition, which is what bounds its reach.** Vitest turns `ssr.resolve.conditions` into `--conditions` flags on the worker process, where Node applies every entry to each package that it resolves natively. Node refuses to strip types from a file under `node_modules`, so a `source` condition reaching that far makes any dependency declaring a TypeScript entry fail to load, the dependency of a dependency included. Resolving inside Vite keeps the condition where nmr decides its reach, and leaves a published package to resolve through its other conditions however it declares `source`.

**The boundary is Vite's resolution, not the package's role.** A workspace package that an externalized dependency imports resolves through Node, which carries no `source` condition, so it reaches that package's build output. Nothing else in a suite resolves that way.

## Resolving through tsconfig paths

A third resolution setting sits alongside those two, and this one is off. `tsconfigPaths: true` emits Vite's `resolve.tsconfigPaths`, so a test reaches an aliased specifier through the `paths` its `tsconfig.json` declares, the way `tsc` does:

```ts
export default defineVitestConfig({ tsconfigPaths: true });
```

It folds across layers like the other two, the last layer to declare it winning. It needs no `ssr` counterpart the way a condition does: Vite holds this setting outside its per-environment resolve options, so the single key reaches the environment a test's own imports resolve through.

**It is an opt-in because its silent direction is the reverse of the two defaults'.** Leaving it off fails loudly, with an unresolved import naming the specifier. Turning it on is the silent direction, for a repo that declares `paths` for `tsc` alone: a specifier that resolved through a package's `exports` starts resolving through the alias instead, and nothing in the run reports the switch. A repo declaring no `paths` is unaffected either way.

**It requires Vite 8**, where `resolve.tsconfigPaths` arrived. nmr declares `vite` as an optional peer at `>=8.0.0 <9`, so a repo holding a stale `vite` of its own hears about it at install time. That check does not reach a repo whose only Vite comes in through Vitest's own dependency, and Vitest 4 accepts Vite 6 and 7: on those, the emitted key does nothing and the aliased import fails exactly as it would with the flag off.

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

`root` is typed to accept only the options that work at the root, so writing a per-project option there is a compile error rather than a setting that never runs. Every surface merges into the generated config rather than replacing it, so overriding one coverage field leaves the rest intact.

`tiers` is keyed by tier name and reaches all four, `unit` included. A key naming no tier throws and names the valid ones: ignoring it would leave the suite green on the budget the key failed to change, which nothing in the run reports. A tier target sets whichever keys it names and no others, so raising `testTimeout` alone leaves that tier's `hookTimeout` at 30 seconds.

Arrays concatenate rather than replace. `exclude` and `setupFiles` therefore add to what the config already declares, and no surface can narrow `include` or drop a default exclusion. Adding an `include` pattern through `project` widens all four projects at once, so a file matching it is collected by each and runs four times.

`resolve.conditions` concatenates too, onto the Vite defaults the factory already emits, but layer order carries no meaning there: Vite consumes conditions as a set, and which one wins is decided by the key order of the consumed package's own `exports`. A later layer can add a condition and can never remove or outrank one an earlier layer contributed. Every entry also reaches Node, which resolves each package reached by a test's imports under `node_modules`, so a condition added here is one that the package's `exports` map may answer. `resolve.alias` is the one key that merges override-first, so a later alias takes precedence over an earlier one.

**A condition for the tests' own resolution goes under `ssr`.** `resolve` is per-environment, and Vitest resolves a test's imports through the server environment, so `root: { ssr: { resolve: { conditions: ['my-condition'] } } }` is the seam that reaches them. A top-level `root: { resolve: { conditions: [...] } }` entry reaches the client environment, which only browser-mode tests resolve through; it composes into that array and never reports that a node test did not see it. `resolve.alias` is not per-environment, so a top-level alias reaches both.

## Sharing options across config files

Vitest resolves one config per run, so a package that adds its own `vitest.config.ts` stops seeing the repo's root config entirely -- not the one setting it meant to change, all of them. Pass the shared settings as a layer instead:

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

Both factories fold any number of layers left to right: a later layer wins on a scalar, arrays concatenate in layer order, and an `undefined` layer is skipped, so `defineVitestConfig(shared, isCI ? ciLayer : undefined)` composes without a spread. `defineRootVitestConfig` takes the same layers, with `monorepoRoot` on the last one -- the config file's own, the only place `import.meta.dirname` names this repo.

Order is the point where `setupFiles` is concerned, since a shared setup file establishes the environment the package's own then runs in. A later layer's `project` block likewise wins over an earlier layer's `tiers` target: the nearer config is the more deliberate.

**A package's own `vite.config.ts` fills that one slot too.** Vitest searches for a config by ascending from the run root and stopping at the first directory holding any of `vitest.config.*` or `vite.config.*`, so a package carrying only a Vite config ends the search there and never reaches the root config. Within a directory `vitest.config.*` is tried first, which makes the fix a Vitest config beside the Vite one, calling `defineVitestConfig()` as any other package config does. Without it the package declares no projects and every tier-selecting command fails with `No projects matched the filter`, `nmr ci` among them. [nmr's readyup kit](../README.md#conformance-checks) reports a package in that state.

**A path in a shared layer must be absolute.** Vitest resolves `setupFiles` against each project's own root, not against the module that declared the path, so a bare `'./vitest.setup.ts'` in a shared module names a different file in every package that consumes it -- and a package that happens to own a file by that name loads the wrong one instead of failing. The co-located form stays correct in a config file that declares the path directly.

**Do not merge two returned configs.** `mergeConfig(defineVitestConfig(), defineVitestConfig(mine))` looks like the idiomatic recovery and fails at startup: both sides declare the same four project names, which Vitest rejects with `Project name "unit" ... is not unique`. Layers merge the factory's inputs instead, which is why they yield four projects however many fold.

A config file that omits the shared layer still loses those settings, silently -- Vitest's own resolution contract, not something the factory can intercept. Guard it with a test that fails when a package's suite goes missing, which also catches a shared `exclude` pattern swallowing one package's tests. Source resolution and git isolation need no such guard: the factory supplies both, so a config file cannot omit them by forgetting a layer.

## What the config excludes

Collection skips `**/node_modules/**`, `**/.git/**`, `**/coverage/**`, and `**/dist/**`. Coverage skips `**/__{fixtures,mocks,tests}__/**`, `**/index.ts`, and `**/*.d.ts`.

`testCollectionExclude` adds to the collection list. It takes directory basenames rather than globs, matched at any depth, so the same array serves the [conventions check](#gating-the-test-file-conventions):

```ts
export default defineVitestConfig({ testCollectionExclude: ['cypress', 'generated'] });
```

Every layer's entries are concatenated, and a name the shared config already prunes is emitted once. A repo needing a glob rather than a directory name has the `project` seam's own `exclude`.

Because both seams concatenate, a consumer can add an exclusion but never remove one. A pattern therefore earns its place in these lists only by preventing a _silent_ failure, one a consumer cannot self-diagnose. A visible failure, such as a stray file sitting at 0% in the coverage report, is left to the consumer's own `project` seam.

Excluding build output from collection is the clearest case. A build that copies `.ts` sources rather than compiling them puts a second copy of the suite under `dist/`, where it is collected and passes green against stale code, and nothing in the run says so. (`nmr build` emits only `.js` and `.d.ts`, neither of which the include matches, so an nmr-built package was never exposed.) `dist/` is deliberately absent from the coverage list, because build output reaching a coverage report shows up as a diagnosable 0% entry.

### Where to put fixtures

A `__fixtures__/` directory is excluded from coverage at any depth, so fixture data stops counting against a package's numbers whether or not a test imports it.

Placing it outside `__tests__/` settles a second problem: anything named `*.test.{ts,tsx}` under `__tests__/` is collected and run, whatever it holds, so a fixture carrying that name becomes a failing test. `src/__fixtures__/` resolves both halves; `src/__tests__/__fixtures__/` resolves the coverage half alone.

No collection pattern names fixtures, and that asymmetry is intentional. A coverage exclusion cannot hide a real test, whereas a collection exclusion can; since it could not be removed, a consumer who legitimately keeps a test under `__fixtures__/` would have no recourse.

## Root-scoped tests

A monorepo's own root-level tests need a second config, because the package config is found by walking up from a package directory:

```ts
// vitest.root.config.ts
import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });
```

This variant reads `pnpm-workspace.yaml` and excludes every workspace package from all four projects, so a root run covers only root-level files. It reports no coverage of its own — packages cover their own sources.

`monorepoRoot` is required, and because the config sits at the monorepo root, it is always `import.meta.dirname`. Stating the root rather than searching for it is what makes the exclusions describe this repo: a search from the working directory would resolve whichever monorepo the run started in, and every project is then pinned to that one. A directory holding no `pnpm-workspace.yaml` throws, naming the directory.
