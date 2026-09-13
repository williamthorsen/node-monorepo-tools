# Dependency upgrades

What `nmr upgrade` covers from each scope, how to declare the upgrade policy and its ceilings, and the subcommands and binary that the upgrade chains run.

`nmr upgrade` reports the dependency upgrades available to your repo. What it covers depends on where you run it:

| Invocation                   | Covers                                      | Catalogs |
| ---------------------------- | ------------------------------------------- | -------- |
| `nmr upgrade` (from root)    | the root `package.json` and every workspace | yes      |
| `nmr upgrade` (in a package) | that package                                | no       |
| `nmr -F <package> upgrade`   | that package, from anywhere                 | no       |
| `nmr root:upgrade`           | the root `package.json`                     | yes      |

A [pnpm catalog](https://pnpm.io/catalogs) is declared in `pnpm-workspace.yaml`, and the upgrade tool reads that file only when it sits at the working directory, irrespective of `--recursive`, which is why `root:upgrade` covers every catalog too. A package-scoped invocation therefore cannot see a dependency the catalog declares, and a package whose dependencies are all catalogued would otherwise report itself up to date. It runs [`report-catalog`](#report-catalog) first instead, which names each catalogued dependency and the root a covering pass runs from.

Both root-scoped invocations precede their report with any active override, which pnpm declares in `pnpm-workspace.yaml`. An override pins a transitive dependency, so an upgrade masked by one never appears in the report.

A `pnpm.overrides` block left in the root `package.json` fails the command instead. pnpm reads no setting from that field as of pnpm 11, so the block pins nothing, while the upgrade tool keeps its own list of dependency fields and goes on rewriting the versions in it under `--write` — a block that looks maintained and governs nothing. Failing ahead of the tool is what keeps that write from happening, on `root:upgrade` as much as on `upgrade`. nmr supports pnpm 11 and later.

The upgrade tool ([taze](https://github.com/antfu-collective/taze)) arrives with nmr, so your repo declares no dependency on it. Everything after the command name is passed through, including the range mode:

```bash
nmr upgrade         # minor and patch upgrades, regardless of the range each dependency declares
nmr upgrade major   # major upgrades, for dependencies carrying no per-package ceiling
nmr upgrade --write # apply the proposals to package.json
```

## Configuring upgrades

Declare version ceilings in a `taze.config.ts` at the monorepo root:

```ts
import { defineConfig } from '@williamthorsen/nmr/taze';

export default defineConfig({
  packageMode: {
    // Hold @types/node at the Node major your `engines` floor requires.
    '@types/node': 'minor',
  },
});
```

`defineConfig` supplies nmr's shared upgrade policy — a seven-day quarantine on brand-new releases, and the pair of settings that report a dependency pinned to an exact version: locked dependencies are included, and the range searched is `minor` — so your config carries only what is specific to your repo. Any setting you declare wins over nmr's default. Passing `undefined` clears a default rather than falling back to it, which is how you hand the quarantine policy back to `pnpm-workspace.yaml`'s `minimumReleaseAge`. `mode` is the exception: the upgrade tool carries a default of its own for it, and clearing nmr's leaves no valid range to search, so name a mode instead.

Everything the [taze configuration](https://github.com/antfu-collective/taze#config-file) accepts is accepted here, with five exceptions that reach the upgrade tool from no config file at all: `concurrency`, `githubActions`, `ignoreOtherWorkspaces`, `nodeVersion`, and `requestTimeout`. The tool's CLI writes a default for each of them over whatever the config declares ([taze#317](https://github.com/antfu-collective/taze/issues/317)), so the command line is the only place they can be set. nmr's ReadyUp kit warns when your config declares one, and [request timeout](#request-timeout) below shows how to set it instead.

> **Note:** This file is what activates nmr's upgrade policy at all. A repo without one gets neither the release quarantine nor the settings that report a dependency pinned to an exact version, and `nmr upgrade` reports nothing in a repo using pnpm's `savePrefix: ''`. nmr's ReadyUp kit warns when the file is missing.

Two consequences of the `minor` range mode the policy declares:

- A `packageMode` entry is honored only by the pass whose mode matches it, or by a `default` pass; every other pass drops that dependency rather than narrowing it. Under the policy's `minor` mode, a `patch` ceiling hides its dependency until you run `nmr upgrade patch`, and a `minor` ceiling hides it from `nmr upgrade major`.
- A `~` range is searched as `^`, so minor upgrades are proposed for it and `--write` applies them under the original `~`. To hold one dependency to patches, give it a `packageMode` entry of `patch` and read it from `nmr upgrade patch`; to hold the whole repo there, declare `mode: 'patch'`.

## Request timeout

Every `upgrade` script reaches the upgrade tool with a 30-second request timeout, in place of the tool's own 5 seconds.

Five seconds is too tight for a registry that proxies npm. The tool fetches a full packument whenever the resolved registry is not `registry.npmjs.org`, and a large one runs to tens of megabytes; the budget covers the whole retry chain rather than a single attempt, so one slow response ends the run with `Timeout requesting "<package>"`. The symptom is an upgrade pass that succeeds or fails according to how warm the tool's cache happens to be.

Pass a different value for one run:

```bash
nmr upgrade --request-timeout 90000
```

To change it for every run, override the `upgrade` script in `.config/nmr.config.ts`, keeping the rest of the default. This is nmr's own config, not the `taze.config.ts` above; taze ignores a `rootScripts` key, and nothing reports it:

```ts
import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  rootScripts: {
    upgrade: 'nmr-report-overrides && nmr-taze --recursive --request-timeout 90000',
  },
});
```

The override is one command string rather than a list of steps, because a composite element names an nmr command and both halves here are binaries.

## Additional subcommands

These commands are available as `nmr` subcommands and as standalone `nmr-`-prefixed binaries (for use in lifecycle hooks).

### `report-catalog`

Report the dependencies the current package takes from a [pnpm catalog](https://pnpm.io/catalogs), which a package-scoped `upgrade` cannot reach (see [dependency upgrades](#dependency-upgrades) for why). Each line names the dependency, its `catalog:` specifier, and the monorepo root a covering pass runs from. The workspace `upgrade` script runs it automatically, so no per-repo wiring is needed. The subcommand belongs to the workspace registry, so it runs from a package directory; the `nmr-report-catalog` bin reports nothing when run from the monorepo root, because a root-scoped pass reads the catalog itself.

```bash
nmr report-catalog
```

### `report-overrides`

Report any active pnpm override, declared in the root `pnpm-workspace.yaml`, reminding developers of overrides that may need cleanup. The root `upgrade` script runs it automatically, so no per-repo wiring is needed. Invoking it directly is useful for a one-off report.

A `pnpm.overrides` block in the root `package.json` fails the command, naming every entry it holds and where to move it — see [dependency upgrades](#dependency-upgrades) for why the block is inert. `pnpx codemod run pnpm-v10-to-v11` performs the move.

```bash
nmr report-overrides
```

## `nmr-taze`

Run the [taze](https://github.com/antfu-collective/taze) dependency-upgrade tool, forwarding every argument to it untouched and adding one of its own: a 30-second request timeout, unless the invocation already carries one. This is what every `upgrade` chain ends with, `root:upgrade` included — see [dependency upgrades](#dependency-upgrades) for the workflow, and [request timeout](#request-timeout) for why the timeout is set here.

Under pnpm's isolated `node_modules`, a transitive package's binary is absent from the consuming repo's `node_modules/.bin`, so a repo that depends on nmr cannot run `taze` directly. `nmr-taze` can, because nmr is a direct dependency, and it resolves the tool from the tree nmr controls.

```bash
nmr-taze --recursive
```
