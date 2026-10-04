# Scripts and configuration

How nmr resolves a command through its three tiers, how script values compose, how hooks wrap a command, how to configure scripts and builds, and what the default commands do beyond what `nmr --help` prints.

## Three-tier override system

The tiers themselves are listed in the [README](../README.md#three-tier-override-system).

### Resolution example

Given the `build` command for a package that defines its own build script:

| Tier | Source                  | Value                   | Wins? |
| ---- | ----------------------- | ----------------------- | ----- |
| 1    | Built-in default        | `['compile']`           | —     |
| 2    | `.config/nmr.config.ts` | _(not set)_             | —     |
| 3    | `package.json` scripts  | `"tsx custom-build.ts"` | ✓     |

If the package does not declare its own override, the highest-tier value that is set wins. Set a script to `""` in `package.json` to skip it for that package.

> **Tip:** If a repo uses `eslint-plugin-package-json/valid-scripts`, that rule flags empty strings as invalid. Use `":"` (the POSIX null command) instead: nmr treats it as a regular override that exits successfully and does nothing.

A `package.json` entry that re-invokes the command under which it is declared is never honored. Honoring `"build": "nmr build"` would spawn a shell running `nmr build` in the same directory, reaching the same entry again without bound, so nmr discards the entry and resolves the command from the tier below. An entry that contains only the self-reference, trailing arguments included, is discarded in silence: It does not declare any step that nmr would lose. Because discarding an entry that chains anything else onto it (`"build": "nmr build && rdy compile"`, or `"build": "rdy compile && nmr build"`) would lose those steps, nmr rejects the invocation instead, naming the file, the key, and where the steps belong. For an ordinary command that is a `<command>:pre` or `<command>:post` script: `"build:pre": "rdy verify"` and `"build:post": "rdy compile"` wrap nmr's own `build` rather than replacing it. For a hook entry it is the entry itself, since nmr does not wrap a `:pre` or `:post` script in any hooks of its own: `"build:post": "nmr build:post && rdy compile"` becomes `"build:post": "rdy compile"`.

nmr recognizes the re-invocation wherever it appears in the entry, on the grammar that [the shelled-nmr line](#script-values) uses, and a segment containing `-F` or `-R` is not one: It hands the command to other scopes rather than back to this one. Nor is `-w` from inside a package, which targets the root's registry and the root's `package.json`. A filter that selects the declaring package is the hole in that exemption: `nmr -F own-pkg build` in `own-pkg`'s own `build` re-enters without bound, and nmr does not recognize it.

### Script values

A script value is a string or an array of steps. Only the built-in defaults and `.config/nmr.config.ts` can contain an array; a `package.json` script must be a string, and any other value is rejected when the scripts are read. Arrays expand to chained `nmr` sub-invocations:

```ts
// "fix": ["lint", "fmt"]
// expands to: nmr lint && nmr fmt
```

Each array element is a command name, optionally preceded by nmr's own flags, split on whitespace: `-R test` runs the element in every package, the way `nmr -R test` does. An element containing a quoted argument or shell syntax is rejected when the config loads: Name that command as a script of its own and reference the name.

#### Where trailing arguments go

nmr passes trailing arguments to every step of a composite, so `nmr fix --dry-run` runs `nmr lint --dry-run`, then `nmr fmt --dry-run`. A step whose work the arguments cannot narrow declines them by taking the long form of an element, and runs unnarrowed:

```ts
// "ci": [{ run: "build", shouldDeclineArguments: true }, "check:strict"]
// nmr ci src/foo.ts  ->  nmr build && nmr check:strict src/foo.ts
```

`{ run }` is the bare string element with room for the declaration; `shouldDeclineArguments` defaults to `false`, and an element that accepts is written as the string. Decline when the step is a prerequisite against which the narrowed steps run, or when the tool that it invokes would be misled: `tsgo --noEmit foo.ts` abandons the tsconfig, which is why every default `typecheck` step declines. A leaf tool that merely ignores what it is handed is not a reason to decline: nmr forwards, and the tool decides.

When every step of a command declines them, nmr rejects the invocation and runs nothing, rather than running the whole command unnarrowed. That is what `nmr typecheck src/foo.ts` gets at the root, whose two steps both decline.

Two kinds of step are not declarable. A string script is one command handed to a leaf tool, so it always receives the arguments. That is why `nmr typecheck src/foo.ts` inside a package still runs `tsgo`, whereas the root rejects it. A `:pre` or `:post` hook never receives them, the arguments having been placed before the hooks wrap the chain.

nmr also does not serve any part of an invocation with trailing arguments from the [check-result cache](check-cache.md#check-result-cache), including the steps that decline them.

A string value is spawned through a shell as one command. An `nmr` invocation inside it is invisible to the process above: A quiet failure prints the output of the whole nested subtree rather than that of the failing step, and a loud run relays the nested tree through a forwarding pipe. nmr writes one line to stderr, in every verbosity, when a command resolves to a step that runs nmr through a shell.

The line names the declaration to which it is an edit (the file, the field, and the key), and its remedy follows from that site. In a `.config/nmr.config.ts` entry, keep the nmr steps as a step list and move anything else to a `<command>:pre` or `<command>:post` script: A step-list element can name only an nmr command, because nmr composes it into `nmr <element>`. A `package.json` entry has to go, since `package.json` cannot declare a step list: Delete it outright when it restates what nmr already runs for that command, and move the steps that it adds to a `<command>:pre` or `<command>:post` script when they are the package's own. When the registry does not define that command, both apply: Name the command in `.config/nmr.config.ts`, and put the package-specific steps in a hook. The pair is named rather than `:post` alone because an entry's extra steps may run on either side of the chain: `rdy verify && nmr compile` puts them first. A hook is the exception at both tiers: nmr does not wrap a `:pre` or `:post` script in any hooks of its own. Move a hook's other steps to a script of their own, and name that script in the step list.

nmr recognizes `nmr` in command position: at the start of a step, after an unquoted `&&`, `||`, `;`, `|`, or a newline, past any leading `NAME=value` assignments, and behind `npx`, `bunx`, or an `exec`, `dlx`, or `x` subcommand of `npm`, `pnpm`, `yarn`, or `bun`. This line reports a boundary rather than enforcing a rule: It covers a step that nmr runs as written, and only the reporting of the nested run is degraded. The line is also partial in three ways: a value-taking flag standing immediately before the program name hides it (`npx -p foo nmr`), a launcher outside that set goes unreported, and a `devBin` substitution that introduces `nmr` itself is not reported, the line being an edit to a declaration rather than to a substitution.

A [self-referential `package.json` entry](#three-tier-override-system) is the shape that nmr cannot run as written, and it is rejected rather than reported. The same recognition finds it, so the same residuals apply: What goes unrecognized there re-enters nmr without bound, which hangs rather than passing quietly.

## Pre and post hooks

The wrap rule and a repo-wide example are in the [README](../README.md#pre-and-post-hooks).

Behaviors worth knowing:

- **Silent when absent**: A missing hook does not produce any error or output.
- **Skip overrides apply to hooks**: A hook value of `""` or `":"` is treated the same as not defining the hook, without a console message.
- **Skipping the main command skips its hooks**: When `X` is overridden to `""` or `":"`, neither `X:pre` nor `X:post` fires.
- **Recursion guard**: Direct invocation of a hook (e.g. `nmr build:pre`) is treated as a leaf operation. It does not itself attempt to resolve `build:pre:pre` or `build:pre:post`.
- **Passthrough args attach only to the main command**: `nmr X --flag value` runs hooks without `--flag value`.

Attach a step to one package's hook:

```jsonc
// packages/my-package/package.json
{
  "scripts": {
    "upgrade:post": "nmr-report-overrides",
  },
}
```

This example calls the bin directly: `report-overrides` is a root-registry command, so `nmr report-overrides` from inside a package fails with `Unknown command`, while the bin runs from either scope.

## Configuration

A minimal `.config/nmr.config.ts` is in the [README](../README.md#configuration).

### `defineConfig` fields

| Field              | Type                                                                          | Description                                                                         |
| ------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `build`            | `{ extraIgnorePatterns?: string[] }`                                          | Patterns added to the build's ignore set (package config only)                      |
| `checkCache`       | `{ enabled?: boolean; extraCommands?: string[]; excludeCommands?: string[] }` | Which commands the [check-result cache](check-cache.md#check-result-cache) may skip |
| `workspaceScripts` | `Record<string, ScriptValue>`                                                 | Scripts added or overridden in the workspace registry (tier 2)                      |
| `rootScripts`      | `Record<string, ScriptValue>`                                                 | Scripts added or overridden in the root registry (tier 2)                           |
| `devBin`           | `Record<string, string>`                                                      | Map binary names to source-repo replacement commands                                |
| `output`           | `{ commandVerbosity?: CommandVerbosity; extraAgentEnvVars?: string[] }`       | How loudly runs report command output; see [configuring](reporting.md#configuring)  |

All fields are optional. [Script values](#script-values) describes `ScriptValue` and its step form, and both types are exported from `@williamthorsen/nmr/config`.

Each field belongs to exactly one tier, and nmr loads from a config only the fields that its tier honors: `build` in a package config, the other five in the monorepo-root config. Declaring a field at the wrong tier fails with a message naming it and where it goes, as does a key that nmr does not recognize at all: A typo cannot degrade into a setting that silently applies nowhere.

### Package-level configuration

A package may have its own `.config/nmr.config.ts`, which `nmr-compile` reads from the package that it is compiling. This tier honors `build` alone; declaring `workspaceScripts`, `rootScripts`, or `devBin` there fails with a message naming them, rather than being quietly ignored: Those belong in the monorepo-root config, and a package that appeared to set them would otherwise build on settings that nothing applied. The monorepo-root config has the mirror restriction: `build` there fails the same way, since only a package's own config affects the compile.

```ts
// packages/my-package/.config/nmr.config.ts
import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  build: { extraIgnorePatterns: ['**/fixtures/**'] },
});
```

`extraIgnorePatterns` adds to the build's [default ignore set](utilities.md#nmr-compile) rather than replacing it, so declaring a pattern cannot make a package publish its own tests. The programmatic `buildPackage` option of the same name behaves identically; its bare `ignorePatterns` is the one that replaces.

> **Building nmr from source:** A config file that has to load while nmr itself is being built (before its `dist` exists) must use the type-only form, `import type { NmrConfig } from '@williamthorsen/nmr/config'` with `satisfies NmrConfig`, which does not produce a runtime import. `defineConfig` is unavailable at that moment, because it resolves through nmr's build output. Every other config, including every consumer's, imports nmr from an installed tarball that contains `dist`, and can use `defineConfig` freely.

### `devBin`: source-repo binary substitution

During development of a CLI tool inside the monorepo, the published binary may not reflect the latest source changes. `devBin` maps a binary name to a replacement command that runs from source:

```ts
export default defineConfig({
  devBin: {
    'my-cli': 'tsx packages/my-cli/src/cli.ts',
  },
});
```

When nmr resolves a command whose first token matches a `devBin` key, it replaces that token with the mapped command. Arguments are preserved. Relative paths in the replacement are resolved from the monorepo root.

For example, if a workspace script resolves to `my-cli --verbose`, nmr rewrites it to `tsx /absolute/path/to/packages/my-cli/src/cli.ts --verbose`.

> **Note:** Path resolution uses a heuristic: Any non-flag token containing `/` is treated as a relative path. This works well for typical dev-tool commands but may incorrectly resolve URL-like values or glob patterns. Flags using `--flag=value` syntax are not resolved; use the spaced form `--flag value` for paths that need resolution.

## Default commands

`nmr --help` lists every default command and the shell command to which it resolves. Repo-wide config (tier 2) and per-package overrides (tier 3) can add to or replace any of them. Under `Package scripts:`, the listing also shows each script in the current scope's `package.json` whose name the registry does not contain, a hook such as `build:pre` included; it omits npm and pnpm lifecycle scripts, such as `prepare` and `postinstall`, which the package manager runs. What the listing does not show is below.

### Build and CI

`ci` is what a code-quality workflow runs; it leaves out the audit, which belongs in a workflow of its own. `prepush` is what a developer runs before pushing: both gates, audit first. The audit takes seconds and `ci` takes minutes, so a vulnerability is reported before the long gate runs. Because `prepush` composes `ci` rather than restating its stages, a stage added to `ci` runs in `prepush` too.

The audit needs network access. Without network access, `ci` is the gate that still runs.

Neither is bound to a git hook. `prepush` is named for when a developer runs it, not for a hook that nmr installs.

### Check and quality

Neither gate computes coverage: Instrumentation multiplies the wall time of the run that they exist to keep short. Coverage is [`test:coverage`](vitest.md#test-selections), run as a step of its own; a repo that wants it inside the gate [overrides](#configuration) `check:strict`.

### Lint

The lint commands respect each package's own `eslint.config.*`. Use the `root:` variants to lint root-level code alone.

Requires `eslint` >= 10 and, for `lint:strict`, `@williamthorsen/strict-lint` >= 9.3.0.

The run never enters a package, so per-package `lint:pre` and `lint:post` hooks do not fire from the root. They still run from inside the package and under `nmr -F <package> lint`.

### Root-only

The `root:`-prefixed commands operate on root-level code only (not workspace packages).
