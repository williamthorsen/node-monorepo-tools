# @williamthorsen/nmr

Context-aware script runner for pnpm monorepos. Ships an `nmr` (node-monorepo run) binary that provides centralized, consistent script execution across workspace packages and the monorepo root.

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

Requires Node.js 24.16 or later.

```bash
pnpm add -D @williamthorsen/nmr
```

### Making `nmr` resolvable

nmr installs as a workspace bin, so the bare `nmr` command works only when your shell can find `<root>/node_modules/.bin/nmr`. Choose one:

- **[direnv](https://direnv.net/)** (recommended for contributors). Add `PATH_add node_modules/.bin` to the repo's `.envrc`, and bare `nmr` works from any subdirectory.
- **`pnpm exec nmr <command>`**. Works with no setup: pnpm resolves the bin from the workspace root.

> **Note:** Avoid `npx nmr`. Inside a git worktree, `npx` can resolve a different nmr binary from outside the working tree, so the command succeeds while running the wrong code.

## Quick start

nmr works out of the box with no configuration. It ships with built-in scripts for common monorepo tasks.

From a package directory:

```bash
nmr test  # Run tests for the current package
nmr build # Compile to .js and .d.ts
nmr check # Typecheck, format check, lint check, and tests
```

From the monorepo root:

```bash
nmr test    # Run root tests + recursive workspace tests
nmr build   # Build all packages
nmr prepush # Run everything the remote runs, before you push
```

nmr detects where you are and selects the right scripts automatically — see [context-aware resolution](#context-aware-resolution) below.

## Context-aware resolution

nmr's key feature is that the same command runs different scripts depending on where you invoke it. It walks up from your current directory to find `pnpm-workspace.yaml`, then checks whether your CWD is inside a workspace package directory.

| Where you run `nmr`               | Registry used     | Working directory | `nmr test` runs                                                      |
| --------------------------------- | ----------------- | ----------------- | -------------------------------------------------------------------- |
| Monorepo root                     | Root scripts      | Monorepo root     | `root:test`, then `-R test`                                          |
| Inside a workspace package        | Workspace scripts | The package root  | `pnpm exec vitest --project unit --project tool` (that package only) |
| Anywhere, with `--workspace-root` | Root scripts      | Monorepo root     | `root:test`, then `-R test`                                          |

Relative paths in a script resolve against that working directory, not the invocation directory.

Use `--workspace-root` to escape package context:

```bash
# From inside packages/nmr-core, run the root check suite
nmr --workspace-root check
```

Two consequences:

- `nmr --workspace-root clean` sweeps every workspace package, as `nmr clean` does from the root.
- Passthrough paths resolve against the working directory: from `packages/nmr/src/`, `nmr --workspace-root fmt pnpm-workspace.yaml` formats the file at the monorepo root.

## Three-tier override system

Scripts resolve through three tiers. Higher tiers override lower ones:

1. **Built-in defaults** — scripts shipped with this package
2. **Repo-wide config** — additions and overrides in `.config/nmr.config.ts`
3. **Per-package overrides** — scripts in a package's `package.json`

### Resolution example

Given the `build` command for a package that defines its own build script:

| Tier | Source                  | Value                   | Wins? |
| ---- | ----------------------- | ----------------------- | ----- |
| 1    | Built-in default        | `['compile']`           | —     |
| 2    | `.config/nmr.config.ts` | _(not set)_             | —     |
| 3    | `package.json` scripts  | `"tsx custom-build.ts"` | ✓     |

If no per-package override exists, the highest-tier value that is set wins. Set a script to `""` in `package.json` to skip it for that package.

> **Tip:** If your repo uses `eslint-plugin-package-json/valid-scripts`, empty strings are flagged as invalid. Use `":"` (the POSIX null command) instead — nmr treats it as a regular override that exits successfully and does nothing.

A `package.json` entry that re-invokes the command it is declared under is never honored. Honoring `"build": "nmr build"` would spawn a shell running `nmr build` in the same directory, reaching the same entry again without bound, so nmr discards the entry and resolves the command from the tier below. An entry that carries only the self-reference, trailing arguments included, is discarded in silence: it declares no step to lose. An entry that chains anything else onto it — `"build": "nmr build && rdy compile"`, or `"build": "rdy compile && nmr build"` — would lose those steps, so nmr rejects the invocation instead, naming the file, the key, and where the steps belong. For an ordinary command that is a `<command>:pre` or `<command>:post` script: `"build:pre": "rdy verify"` and `"build:post": "rdy compile"` wrap nmr's own `build` rather than replacing it. For a hook entry it is the entry itself, since nmr wraps a `:pre` or `:post` script in no hooks of its own — `"build:post": "nmr build:post && rdy compile"` becomes `"build:post": "rdy compile"`.

The re-invocation is recognized wherever it stands in the entry, on the grammar [the shelled-nmr line](#script-values) uses, and a segment carrying `-F` or `-R` is not one — it hands the command to other scopes rather than back to this one. Nor is `-w` from inside a package, which reaches the root's registry and the root's `package.json`. A filter that selects the declaring package is the hole in that exemption: `nmr -F own-pkg build` in `own-pkg`'s own `build` re-enters without bound, and nmr does not recognize it.

### Script values

A script value is a string or an array of steps. Only the built-in defaults and `.config/nmr.config.ts` carry an array; a `package.json` script must be a string, and any other value is rejected when the scripts are read. Arrays expand to chained `nmr` sub-invocations:

```ts
// "fix": ["lint", "fmt"]
// expands to: nmr lint && nmr fmt
```

Each array element is a command name, optionally preceded by nmr's own flags, split on whitespace — `-R test` runs the element in every package, the way `nmr -R test` does. An element carrying a quoted argument or shell syntax is rejected when the config loads: name that command as a script of its own and reference the name.

#### Where trailing arguments go

Trailing arguments reach every step of a composite, so `nmr fix --dry-run` runs `nmr lint --dry-run`, then `nmr fmt --dry-run`. A step whose work the arguments cannot narrow declines them by taking the long form of an element, and runs unnarrowed:

```ts
// "ci": [{ run: "build", declinesArgs: true }, "check:strict"]
// nmr ci src/foo.ts  ->  nmr build && nmr check:strict src/foo.ts
```

`{ run }` is the bare string element with room for the declaration; `declinesArgs` defaults to `false`, and an element that accepts is written as the string. Decline where the step is a prerequisite the narrowed steps run against, or where the tool it reaches would be misled — `tsgo --noEmit foo.ts` abandons the tsconfig, which is why every default `typecheck` step declines. A leaf tool that merely ignores what it is handed is not a reason to decline: nmr forwards, and the tool decides.

Where no step of a command accepts them, nmr rejects the invocation and runs nothing, rather than running the whole command unnarrowed. That is what `nmr typecheck src/foo.ts` gets at the root, whose two steps both decline.

Two kinds of step are not declarable. A string script is one command handed to a leaf tool, so it always receives the arguments — which is why `nmr typecheck src/foo.ts` inside a package still reaches `tsgo`, where the root rejects it. A `:pre` or `:post` hook never receives them, the arguments having been placed before the hooks wrap the chain.

An invocation carrying trailing arguments also serves no part of its work from the [check-result cache](#check-result-cache), the steps that decline them included.

A string value is spawned through a shell as one command, so an `nmr` invocation inside it is invisible to the process above: a quiet failure surrenders the whole nested subtree rather than the failing step, and a loud run relays the nested tree through a forwarding pipe. nmr writes one line to stderr, in every verbosity, when a command resolves to a step reaching nmr through a shell.

The line names the declaration it is an edit to — the file, the field, and the key — and its remedy follows from that site. A `.config/nmr.config.ts` entry keeps its nmr steps as a step list and moves anything else to a `<command>:pre` or `<command>:post` script: a step-list element is composed into `nmr <element>`, so it can name only an nmr command. A `package.json` entry has to go, since `package.json` holds no step list: delete it outright when it restates what nmr already runs for that command, and move the steps it adds to a `<command>:pre` or `<command>:post` script when they are the package's own. Where the registry defines no such command, both apply: name the command in `.config/nmr.config.ts`, and put the package-specific steps in a hook. The pair is named rather than `:post` alone because an entry's extra steps may run on either side of the chain: `rdy verify && nmr compile` puts them first. A hook is the exception at both tiers: nmr wraps a `:pre` or `:post` script in no hooks of its own, so a hook's other steps become a script of their own that the step list names.

nmr recognizes `nmr` in command position: at the start of a step, after an unquoted `&&`, `||`, `;`, `|`, or a newline, past any leading `NAME=value` assignments, and behind `npx`, `bunx`, or an `exec`, `dlx`, or `x` subcommand of `npm`, `pnpm`, `yarn`, or `bun`. This line reports a boundary rather than enforcing a rule — it covers a step nmr runs as written, and only the reporting of the nested run is degraded — and it stays partial in stated ways: a value-taking flag standing immediately before the program name hides it (`npx -p foo nmr`), a launcher outside that set goes unreported, and a `devBin` substitution that introduces `nmr` itself is not reported, the line being an edit to a declaration rather than to a substitution.

A [self-referential `package.json` entry](#three-tier-override-system) is the shape nmr cannot run as written, and it is rejected rather than reported. The same recognition finds it, so the same residuals apply — what goes unrecognized there re-enters nmr without bound, which hangs rather than passing quietly.

## Configuration

Create `.config/nmr.config.ts` in the monorepo root to add or override scripts. A package may carry one too, for [build settings of its own](#package-level-configuration):

```ts
import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  workspaceScripts: {
    'copy-content': 'tsx scripts/copy-content.ts',
  },
  rootScripts: {
    'demo:catwalk': 'pnpx http-server --port=5189 demos/catwalk/',
  },
});
```

### `defineConfig` fields

| Field              | Type                                                                          | Description                                                           |
| ------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `build`            | `{ extraIgnorePatterns?: string[] }`                                          | Patterns added to the build's ignore set (package config only)        |
| `checkCache`       | `{ enabled?: boolean; extraCommands?: string[]; excludeCommands?: string[] }` | Which commands the [check-result cache](#check-result-cache) may skip |
| `workspaceScripts` | `Record<string, ScriptValue>`                                                 | Scripts added or overridden in the workspace registry (tier 2)        |
| `rootScripts`      | `Record<string, ScriptValue>`                                                 | Scripts added or overridden in the root registry (tier 2)             |
| `devBin`           | `Record<string, string>`                                                      | Map binary names to source-repo replacement commands                  |

All fields are optional. A `ScriptValue` is a command string or an array of steps, each a command string or `{ run, declinesArgs? }`; both are described in [script values](#script-values), and both types are exported from `@williamthorsen/nmr/config`.

Each field belongs to exactly one tier, and a config loads only the fields its own tier honors: `build` in a package config, the other four in the monorepo-root config. Declaring a field at the wrong tier fails with a message naming it and where it goes, as does a key nmr does not recognize at all — a typo cannot degrade into a setting that silently applies nowhere.

### Package-level configuration

A package may carry its own `.config/nmr.config.ts`, which `nmr-compile` reads from the package it is compiling. This tier honors `build` alone; declaring `workspaceScripts`, `rootScripts`, or `devBin` there fails with a message naming them, rather than being quietly ignored — those belong in the monorepo-root config, and a package that appeared to set them would otherwise build on settings nothing applied. The monorepo-root config carries the mirror restriction: `build` there fails the same way, since only a package's own config reaches the compile.

```ts
// packages/my-package/.config/nmr.config.ts
import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  build: { extraIgnorePatterns: ['**/fixtures/**'] },
});
```

`extraIgnorePatterns` adds to the build's [default ignore set](#nmr-compile) rather than replacing it, so declaring a pattern cannot start a package shipping its own tests. The programmatic `buildPackage` option of the same name behaves identically; its bare `ignorePatterns` is the one that replaces.

> **Building nmr from source:** a config file that has to load while nmr itself is being built — before its `dist` exists — must use the type-only form, `import type { NmrConfig } from '@williamthorsen/nmr/config'` with `satisfies NmrConfig`, which carries no runtime import. `defineConfig` resolves through nmr's build output and so is unavailable at that moment. Every other config, including every consumer's, installs nmr from a tarball that ships `dist` and can use `defineConfig` freely.

### `devBin` — source-repo binary substitution

When developing a CLI tool inside the monorepo, the published binary may not reflect your latest source changes. `devBin` lets you map a binary name to a replacement command that runs from source:

```ts
export default defineConfig({
  devBin: {
    'my-cli': 'tsx packages/my-cli/src/cli.ts',
  },
});
```

When nmr resolves a command whose first token matches a `devBin` key, it replaces that token with the mapped command. Arguments are preserved. Relative paths in the replacement are resolved from the monorepo root.

For example, if a workspace script resolves to `my-cli --verbose`, nmr rewrites it to `tsx /absolute/path/to/packages/my-cli/src/cli.ts --verbose`.

> **Note:** Path resolution uses a heuristic: any non-flag token containing `/` is treated as a relative path. This works well for typical dev-tool commands but may incorrectly resolve URL-like values or glob patterns. Flags using `--flag=value` syntax are not resolved; use the spaced form `--flag value` for paths that need resolution.

## Pre and post hooks

Every `nmr X` invocation auto-wraps as the equivalent of `nmr X:pre && nmr X && nmr X:post`. Hooks are first-class scripts that resolve through the same three tiers as any other script (built-in defaults, then `.config/nmr.config.ts`, then per-package `package.json`). Wrapping is uniform: nested invocations from composite expansion get their own hook treatment. A failing hook ends the sequence, and its exit code propagates.

Behaviors worth knowing:

- **Silent when absent**: Missing hooks produce no error and no output.
- **Skip overrides apply to hooks**: A hook value of `""` or `":"` is treated the same as not defining the hook, with no console message.
- **Skipping the main command skips its hooks**: When `X` is overridden to `""` or `":"`, neither `X:pre` nor `X:post` fires.
- **Recursion guard**: Direct invocation of a hook (e.g. `nmr build:pre`) is treated as a leaf operation. It does not itself attempt to resolve `build:pre:pre` or `build:pre:post`.
- **Passthrough args attach only to the main command**: `nmr X --flag value` runs hooks without `--flag value`.

Extend `nmr build` with a pre-build step for every workspace package:

```ts
// .config/nmr.config.ts
import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  workspaceScripts: {
    'build:pre': 'node scripts/generate-manifest.ts',
  },
});
```

Attach a step to one package's hook:

```jsonc
// packages/my-package/package.json
{
  "scripts": {
    "upgrade:post": "nmr-report-overrides",
  },
}
```

The second example calls the bin directly: `report-overrides` is a root-registry command, so `nmr report-overrides` from inside a package fails with `Unknown command`, while the bin runs from either scope.

## What nmr reports

Every command nmr runs reports one line naming the scope it ran at, the command, the outcome, and the timing:

```console
✅ nmr-core: test: passed in 12.4s
❌ nmr: build: failed in 1.2s (exit 1)
⏭️ nmr-core: test: passed 4m ago on this tree, saved ~12s
⛔ nmr-core: lint: skipped, the override is empty
```

A recalled pass also carries an excerpt of the run it recalls, where that run left one; see [Replaying a skipped run's output](#replaying-a-skipped-runs-output).

The scope is the directory the command's registry belongs to: a package's own directory, or the monorepo root. Durations and ages truncate and carry at most two units, so a check that passed 90 seconds ago reports `1m 30s ago` and never `2m ago`.

Verdicts nest. A composite reports, and so does every command it expands into; a `:pre` or `:post` hook reports nothing of its own, since the command it wraps already reports for the chain, though a hook that delegates to a named command reports under that name. A `-R` or `-F` invocation reports nothing either, every scope it fans out to reporting instead. A cold repo-wide `nmr ci` in this package's own monorepo spends 26 lines on a run that prints roughly 250.

A verdict is one write of at most 512 bytes, the smallest `PIPE_BUF` POSIX permits, so packages running concurrently under `pnpm --recursive` cannot interleave within a line. A line longer than that is cut and marked with `…`; nothing nmr reports today comes near it.

**Verdicts print in every verbosity.** `-q` withholds the output of the commands nmr runs, never nmr's own words: a passing quiet run reports its verdicts and nothing else. A command whose override resolved to `""` or `":"` reports the skip rather than exiting 0 in silence, which is what separates it from a command that passed. An `NMR_RUN_IF_PRESENT` miss reports nothing, having no command to report on.

### Reporting for a machine

`--json` renders each verdict as a JSON object instead of a line of prose — one object per line, newline-delimited, with no enclosing array and no separators between them. A consumer parses each line as it arrives, and a run cut off partway still leaves every line it already emitted parseable, which an enclosing array would not.

```console
$ nmr --json check
{"command":"typecheck","scope":"nmr-core","outcome":"passed","durationMs":255}
{"command":"fmt:check","scope":"nmr-core","outcome":"recalled","ageMs":240000,"savedMs":3888,"replay":[{"command":"fmt:check","excerpt":"Checking formatting... All matched files use Prettier code style!","scope":"nmr-core"}]}
{"command":"check","scope":"nmr-core","outcome":"passed","durationMs":31204}
```

Every object carries `command`, `scope`, and `outcome`, and then what that outcome carries and no other does:

| `outcome`  | Also carries                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `passed`   | `durationMs`                                                                                               |
| `failed`   | `durationMs`, `exitCode`                                                                                   |
| `recalled` | `ageMs`, `savedMs`, and `replay` where the skip has excerpts to [replay](#replaying-a-skipped-runs-output) |
| `no-op`    | `reason`, either `empty-override` or `noop-override`                                                       |

Both renderings are produced from one record, so neither reports what the other does not. Where the prose line makes a presentation decision the record does not — a saving too small to be worth a clause, say — the object carries the fact and leaves the decision to whoever reads it.

**An object is one write of at most 512 bytes**, the [same ceiling](#what-nmr-reports) a prose line is held to, so packages running concurrently under `pnpm --recursive` cannot interleave within one. Cuts land inside the record's text rather than across its structure, so the line still parses, and a record that overruns is fitted by rungs — each shedding what a reader can better spare than the one below it:

1. **The excerpts are shortened toward one another**, so an assembly's constituents come down together rather than the first ones being emptied to leave the last whole. No excerpt is cut below `…`, which keeps a cut one distinguishable from a run that recorded nothing.
2. **The excerpts go**, leaving the `scope` and `command` that name each constituent. An entry carrying no `excerpt` key is one whose text did not fit.
3. **The trailing constituents go**, as the prose line drops its own tail, and the `replay` array itself once none fit.
4. **The `scope` and `command` are cut**, each marked. This is the last resort and the reason for it is the ceiling itself: a line that overruns can be split across a pipe and corrupt the records of every scope sharing it, where a marked cut costs only its own.

A package-scoped `check` carries four constituents and fits uncut. A four-package root `check` assembles twelve — `typecheck` and `test` each fan out to every package, and a nested composite's list is spliced in flat — which is more than the ceiling can name: it reaches rung 3, keeping eight and dropping the trailing four. Rung 4 needs a scope and command running to hundreds of bytes between them.

**The mode implies quiet.** The commands' own output is withheld, so stdout carries the objects alone — no prose verdict, and no override notice. `NMR_COMMAND_VERBOSITY=full` does not opt back out. A failure still surrenders the failing command's output, on stderr, as under any quiet run. Both modes leave a command on the same channels, so a machine-readable run and a quiet one share a [retention key](#replaying-a-skipped-runs-output): each replays what the other recorded.

The format is nmr's own reporting and not a mode the commands it runs are told about, so it is out of the [pass key](#what-the-key-is-made-of) and the retention key alike. Selecting it neither invalidates a recorded pass nor costs a replay.

`--log`, `--help`, and `--version` are unaffected: none of them reports a verdict, and what `--log` prints is a tool's own transcript, which has no rendering as a record.

## Check-result cache

A check that passed on a working tree passes again on the same working tree. nmr records that, and the next run of the same command on an unchanged tree exits 0 without doing the work:

```console
$ nmr ci
# ... four minutes of build, typecheck, lint, and tests ...

$ nmr ci
⏭️ node-monorepo-tools: ci: passed 2m ago on this tree, saved ~4m
```

Composite commands expand into child `nmr` processes, so one green `nmr ci` records a pass for every cacheable command in the chain, at every scope it ran at. A later `nmr check`, `nmr typecheck`, or `nmr -F core test` on the same tree skips too. The skip is [reported](#what-nmr-reports) in every verbosity.

The cache is a working-tree cache, not a build cache: it answers "has this exact tree already passed this check?" and nothing else. It is also local to one checkout (the install fingerprint in its key is machine-specific), so it saves repeated work in a working copy rather than sharing results across machines or with CI.

### What is cached

Cacheable by default: `check`, `check:strict`, `ci`, `fix:check`, `fmt:check`, `lint:check`, `lint:strict`, `test`, `test:coverage`, `test:tool`, `test:unit`, `typecheck`, and the `root:` variants `root:check`, `root:lint:check`, `root:lint:strict`, `root:test`, `root:test:tool`, `root:test:unit`, and `root:typecheck`.

Everything else runs every time:

| Command                         | Why it is never skipped                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `audit`, `prepush`              | Consult a vulnerability database that moves without the tree. `prepush`'s `ci` constituent still skips while its `audit` runs every time. |
| `build`, `compile`              | Carry a cache of their own.                                                                                                               |
| `fix`, `fmt`, `lint`, `upgrade` | Rewrite the tree they were asked about, so a recorded pass would describe a tree that no longer exists.                                   |
| `test:all`                      | Reaches the `localhost` and `remote` tiers, which the environment supplies rather than the tree.                                          |

### The exit-status-only contract

**A cacheable name promises that its whole contribution is an exit status**, through its entire chain, `:pre` and `:post` hooks included. A hit skips that chain wholesale, so any file a cacheable command was relied on to produce is a file that will not appear.

`test:coverage` is cacheable on exactly this reading: what it contributes is the pass, not the `coverage/` directory, which a skipped run leaves as whatever the last real run wrote. Read `coverage/` after a `test:coverage` that may have skipped, and it may be stale; `--no-cache` is how you insist on a fresh one.

Overriding a cacheable name, in `package.json` or in `workspaceScripts`, inherits its cacheability. An override that writes something anyone depends on belongs in `excludeCommands`.

### What the key is made of

A hit requires all of these to match the run that recorded the pass:

- **The working tree's content**, hashed from the commit's tree object folded with the current content of every path git reports as changed or untracked. Timestamps are not content, so a `touch` that rewrites no bytes leaves the hash alone.
- **The command string that would run**, hooks and all, and the scope it would run in.
- **nmr's version**, the **Node version**, and the **platform and architecture**.
- **What pnpm has installed**, so an install, a prune, or a lockfile change forces a re-run.
- **`TZ`, `LANG`, `LC_ALL`, and `NODE_OPTIONS`.** This set is fixed, so two machines that differ only in shell decoration still agree.

A hit additionally requires the build output of every package nmr's own build covers to be present, and to have been built from this tree. Output is git-ignored, so neither its removal nor its replacement moves the hash: restoring a tree with `git stash` or `git checkout` restores none of the output that tree was built with. nmr compares each covered package's recorded build digest against the one on disk, so a `dist` compiled from another tree is a miss the following run repairs. A package that overrides `build` or `compile` emits on terms nmr does not know and is exempt.

A pass is recorded only when the command exits 0, only when the tree still matches the one the run started against, only when every covered package's output is present and unchanged since the run started, and never for a run that executed nothing (a `""`/`":"` skip override, or an `NMR_RUN_IF_PRESENT` miss). Output that moves mid-run leaves no answer to which output the pass was earned over, whether another process rebuilt it or the chain built it itself: `nmr ci` is the one default command whose chain does, and it records nothing on a run whose build did work. The `nmr check:strict` inside that chain still records, because its own window opens after the build.

### Out of contract

These change what a check concludes without moving the hash. Where one applies, exclude the affected command:

- **Content filters.** `core.autocrlf` and `.gitattributes` filters mean the bytes on disk differ from the bytes git records; the hash follows what is on disk, but a checkout on another platform may not reproduce it.
- **Symlinked inputs.** A symlink is hashed by the path it names, not by the content at the far end.
- **Gitignored inputs.** Anything git does not report is invisible to the hash. The build-output probe is the one exception, and covers only nmr's own build.
- **`passWithNoTests`.** A suite that collects no files exits 0, and that green is recorded like any other.

Committing an already-checked tree also moves the hash, because the commit's tree object is the base of the fold; the next run does the work again. The reverse holds and is useful: a rebase or an amended message that preserves content leaves the hash alone, as does checking out a branch whose tree is identical.

### When the gate stands aside

The gate never wrongly skips. Where it cannot be sure, it does nothing and the command runs:

- Outside a git repository, when git fails, or when there is no commit at `HEAD`.
- When the repository declares or contains submodules, whose content the hash does not cover.
- When the monorepo root is not the git toplevel.
- When a changed path cannot be read, or is neither a file nor a symlink (an untracked nested repository, for instance).
- When there is no pnpm install to fingerprint.
- Under a `devBin` substitution, which runs a binary built from somewhere the hash does not describe.
- For any invocation carrying arguments after the command name, and for every step below it: the arguments narrow what runs, and a step served from a recorded pass is a step that did not.

`NMR_DEBUG=1` reports why a run did not skip and why the gate stood aside.

### Replaying a skipped run's output

A skip reports an excerpt of the run it recalls, marked as a recording rather than as this run's output:

```console
$ nmr test
# ... the suite runs ...

$ nmr test
⏭️ nmr: test: passed 2m ago on this tree, saved ~12s — replayed: Test Files 6 passed (6) Tests 41 passed (41)
```

The excerpt is the last blank-line-delimited block of what the command wrote, which is the closing statement a tool separates from its progress output. It is flattened onto one line, with escape sequences stripped, table rules dropped, and a redrawn progress line reduced to what a reader was left looking at. Nothing is parsed and no figure is computed: nmr replays bytes it recorded. A block wider than a few kilobytes is cut and marked with `…`, so a command whose closing statement is one long line cannot carry its whole output into the cache.

The excerpt and the whole transcript it is drawn from are written by the same operation that records the pass, so a pass declined because the tree moved or build output changed leaves neither behind, and `nmr clean` clears both along with the passes they belong to.

**Capture happens at the command, and only where nmr can see its output.** A command whose stdout or stderr is a terminal writes where nmr never reads, so an interactive run retains nothing and its progress display is untouched; a piped or redirected run, and any run under `-q`, retains both streams. A composite hands its descriptors to the child `nmr` processes below it and captures nothing of its own, and a `:pre` or `:post` hook contributes nothing to the command it wraps: an excerpt is the command's own output or none.

**A composite replays its constituents' excerpts.** Capturing nothing of its own, a composite assembles what its constituents recorded, each line attributed to the scope and command that produced it:

```console
$ nmr check
⏭️ nmr-core: check: passed 3m ago on this tree, saved ~48s — replayed: nmr-core: fmt:check: All matched files use Prettier code style!; nmr-core: test: Test Files 6 passed (6) Tests 41 passed (41)
```

The assembly is flat: a constituent that is itself a composite contributes its own leaves' lines, so a skipped `ci` replays a package's `test` rather than one opaque `check:strict` line. A delegate expands into the scopes it fans out to, and a constituent that recorded no excerpt is absent rather than inferred: `typecheck` and `lint:check` print nothing on success and contribute nothing above, and a command outside the [cacheable set](#what-is-cached) records nothing at all, so `ci` replays what `check:strict` earned and nothing for `build`.

It is assembled when the composite records its pass rather than when it skips, so every excerpt in it was certified during that one run, on that one tree. `NMR_RUN_ID` is what makes that provable; see [reserved environment variables](#reserved-environment-variables).

**A skip certifies what it replays.** Recalling a pass proves the excerpt describes this tree, and a matching retention key proves it describes this presentation environment, so a skip restamps the recalled entry with the run replaying it. A constituent already warm when a composite ran therefore still contributes its line: `nmr check` after `nmr test` replays the test summary. The restamp touches nothing else -- the instant and the duration belong to the run that earned the pass.

**A replay is held to more than the pass is.** Retention carries its own key: the [pass key](#what-the-key-is-made-of) folded with the channel each output stream ran on and with `CI`, `COLUMNS`, `FORCE_COLOR`, `NO_COLOR`, and `TERM`. A recording made under a different one is recalled as a pass all the same; its excerpt is simply not replayed, and the verdict prints alone, as it does for a pass that retained nothing.

The whole line, excerpt included, is held to the same [512-byte ceiling](#what-nmr-reports) every verdict is, so one write still carries it whole under concurrent fan-out. An assembly wide enough to overrun it is cut and marked with `…` rather than spread over several lines.

### Reading a retained run

The excerpt is a line; the run behind it is kept whole. `nmr --log <command>` prints it, led by a header dating what follows:

```console
$ nmr --log test
📼 nmr: test — recorded 2026-08-12T15:04:05.412Z (12m ago), ran in 12.4s
$ pnpm exec vitest --project unit --project tool

 ✓ src/__tests__/resolver.unit.test.ts (18 tests) 12ms

 Test Files  6 passed (6)
      Tests  41 passed (41)
```

The header is what presents the body as a recording rather than as this invocation's output. The command string is the whole chain, hooks included, so it names what earned the pass and not merely what was typed. A flag rather than a subcommand, since `log` would collide with the script registry.

**Reading a recording runs nothing.** No hook runs, no verdict prints, and nothing is recorded or restamped. `--no-cache` governs running rather than reading and is ignored.

**A recording is held to the tree, not to the terminal.** `--log` prints exactly what a skip would have recalled: the [pass key](#what-the-key-is-made-of) has to match. The [retention key](#replaying-a-skipped-runs-output) is not consulted, so a recording made under a different terminal width, or through a pipe, still prints -- a reader at a terminal being shown what a piped run wrote is the case the flag exists for.

**A composite prints its assembly.** Retaining nothing of its own, a composite prints the excerpts its constituents recorded, one attributed line each. The transcript of any one of them is that constituent's own `--log` to print.

**Nothing to show is said rather than left blank.** A refusal names which it is -- the command is outside the [cacheable set](#what-is-cached), the gate is [standing aside](#when-the-gate-stands-aside), nothing has recorded a pass, the last pass was recorded under something this run does not share, or the pass retained no output, having printed none or written to a terminal -- and exits non-zero, so a caller can tell an empty `stdout` from a recording. A mismatch names the ingredient that moved, the tree or the chain or a version, so a reader whose `git status` is clean is not sent looking there.

```console
$ nmr --log test
📭 nmr: test: no recording; the last pass was 3m ago, on a tree this is not
```

**`--log` reaches the scopes `-F` and `-R` select.** The flag rides the delegate, so each scope prints its own recording. There a scope with nothing to show reports its gap and exits 0: partial coverage is a survey's normal shape, and failing on the first gap would hide every scope that had something.

**Retention has a ceiling of 256 KiB per recorded pass**, distinct from the 512 bytes a verdict line is held to. A transcript overrunning it keeps 128 KiB from each end, because a run's opening and its closing statement each carry what the other does not, and the drop is marked with a line naming the bytes it stands for rather than being cut silently.

### Bypassing and clearing

Reach for these in order; the first is almost always the right one.

| Step                                   | Effect                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `nmr --no-cache <command>`             | Runs the command, then records the fresh result. Reaches the whole chain. |
| `NMR_NO_CACHE=1`                       | The same, for every nmr invocation in the shell.                          |
| `rm -rf node_modules/.cache/nmr-check` | Forgets every recorded pass, leaving build output alone.                  |
| `nmr clean`                            | Forgets every recorded pass and removes build output, at any scope.       |

`--no-cache` belongs before the command name. After it, it is an argument to the command rather than a flag to nmr; nmr says so rather than letting the bypass silently not happen.

### Reserved environment variables

`NMR_TREE_SNAPSHOT` is nmr's own: it carries one observation of the tree from a top-level invocation down to the processes it spawns, so a chain hashes the tree once rather than at every link. nmr trusts an inherited value only while `HEAD` still stands where it did when the observation was taken, which bounds a process that outlives the run that spawned it. That bound does not extend to a tree edited without committing, so **a process that survives its run and later invokes nmr should clear `NMR_TREE_SNAPSHOT`** — a test suite that shells out to `nmr` is the case worth checking.

`NMR_RUN_ID` is nmr's own too: it carries one run's identity from a top-level invocation down to the processes it spawns, so the excerpts recorded at every scope during one run are recognizable as that run's, and a composite can assemble from them. Where `NMR_TREE_SNAPSHOT` is bounded by `HEAD`, this is bounded by the tree hash each entry records, so a process that outlives its run and carries the identity into a later one contributes nothing to that run's assemblies.

`NMR_COMMAND_VERBOSITY` is nmr's own as well, and carries how loudly a run reports the output of the commands it runs. Its values are `full` and `quiet`; any other non-empty value is reported and exits 1, rather than falling back to a mode nobody chose, and an empty value reads as unset. Each process in a chain suppresses the output of the command it runs rather than of everything below it, so a failure still surrenders the failing command's output. It governs those commands' output alone: nmr's [verdicts](#what-nmr-reports) print in every verbosity, and the override notice is the one message a quiet run withholds.

`-q` sets it for the run and outranks an inherited value. Both values are spelled out so either direction is expressible: export `NMR_COMMAND_VERBOSITY=quiet` for a quiet shell, and set `full` on one invocation to opt back out.

`NMR_REPORT_FORMAT` is nmr's own as well, and carries how nmr renders its own verdicts. Its values are `text` and `json`; any other non-empty value is reported and exits 1, and an empty value reads as unset. `--json` sets it for the run and outranks an inherited value, and both values are spelled out so either direction is expressible: export `NMR_REPORT_FORMAT=json` for a shell whose consumer parses, and set `text` on one invocation to opt back out. Two sources, then, where a verbosity has four: no repo-level default and no harness detection, since detection would hand every agent JSON in place of the prose the [shipped guidance](#agent-guidance) teaches. See [reporting for a machine](#reporting-for-a-machine) for what the objects carry.

#### Where a verbosity comes from

Four sources, in precedence order. Each is read once, at the top of a chain: the resolved value travels down as `NMR_COMMAND_VERBOSITY`, so a nested process reads a decision already made rather than making its own.

| Source                                                | Set it when                                                |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `-q`                                                  | One invocation should be quiet.                            |
| `NMR_COMMAND_VERBOSITY`                               | A shell, or a harness that launches one, should be quiet.  |
| `output.commandVerbosity` in the monorepo-root config | A repo should be quiet for everyone working in it.         |
| An agent harness nmr recognizes in the environment    | Nothing above applies and an agent is running the command. |

Falling off the bottom leaves the run `full`, which is what an unrecognized harness gets: detection adds quiet where it fires and changes nothing where it does not.

Detection reads a set of environment-variable names and fires on any one of them holding a non-empty value. The shipped set is `CLAUDECODE`, `ROVODEV_CLI`, and `ROVO_CLI`. **Treat that set as perishable.** The names belong to ecosystems nmr does not control and that rename, and a rename fails silently here, since the symptom is a return to loud output rather than an error. `output.extraAgentEnvVars` is how a repo adds a name — a harness nmr has never heard of, or one whose marker was renamed after the installed version shipped — without waiting for a release. A repo that wants no detection at all configures `output.commandVerbosity: 'full'`, which outranks it.

### Configuring

```ts
export default defineConfig({
  checkCache: {
    // Names promising exit-status-only semantics through their whole chain.
    extraCommands: ['verify:contracts'],
    // Names that turned out to do more than report an exit status.
    excludeCommands: ['test:coverage'],
  },
});
```

`extraCommands` extends the default set rather than replacing it, so naming one command cannot silently drop the rest; `excludeCommands` is applied afterwards, so a name in both is excluded. `enabled: false` turns the gate off entirely. The key is `checkCache`, in the monorepo-root config.

```ts
export default defineConfig({
  output: {
    // The verbosity a run takes when neither `-q` nor the environment named one.
    commandVerbosity: 'quiet',
    // Markers of a harness the shipped set does not name, added to it rather than replacing it.
    extraAgentEnvVars: ['MY_HARNESS'],
  },
});
```

`output` is a monorepo-root key, and both of its fields feed the [verbosity ladder](#where-a-verbosity-comes-from).

## Dependency upgrades

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

### Configuring upgrades

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

### Request timeout

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

## Default script registries

These scripts are available out of the box. Repo-wide config (tier 2) and per-package overrides (tier 3) can add to or replace any of them.

### Workspace scripts

| Command          | Runs                                                        |
| ---------------- | ----------------------------------------------------------- |
| `build`          | `compile`                                                   |
| `check`          | `typecheck`, `fmt:check`, `lint:check`, `test`              |
| `check:strict`   | `typecheck`, `fmt:check`, `lint:strict`, `test`             |
| `clean`          | `nmr-clean`                                                 |
| `compile`        | `nmr-compile`                                               |
| `fix`            | `lint`, `fmt`                                               |
| `fix:check`      | `fmt:check`, `lint:check`                                   |
| `fmt`            | `nmr-fmt --write`                                           |
| `fmt:check`      | `nmr-fmt --check`                                           |
| `lint`           | `eslint --fix .`                                            |
| `lint:check`     | `eslint .`                                                  |
| `lint:strict`    | `strict-lint`                                               |
| `report-catalog` | `nmr-report-catalog`                                        |
| `test`           | `pnpm exec vitest --project unit --project tool`            |
| `test:all`       | `pnpm exec vitest`                                          |
| `test:coverage`  | `pnpm exec vitest --project unit --project tool --coverage` |
| `test:tool`      | `pnpm exec vitest --project tool`                           |
| `test:unit`      | `pnpm exec vitest --project unit`                           |
| `test:watch`     | `pnpm exec vitest --project unit --project tool --watch`    |
| `typecheck`      | `tsgo --noEmit`                                             |
| `upgrade`        | `nmr-report-catalog && nmr-taze`                            |
| `view-coverage`  | `open coverage/index.html`                                  |

`fmt` and `fmt:check` select their files through git rather than by walking the directory, which is what makes a package-level run and a root-level run apply the same ignore rules — see [file selection](#file-selection).

#### Test selections

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

### Root scripts

#### Build and CI

| Command   | Runs                    |
| --------- | ----------------------- |
| `build`   | `-R build`              |
| `ci`      | `build`, `check:strict` |
| `clean`   | `nmr-clean`             |
| `prepush` | `audit`, `ci`           |

`ci` is what a code-quality workflow runs; it leaves out the audit, which belongs in a workflow of its own. `prepush` is what a developer runs before pushing: both gates, audit first. The audit takes seconds and `ci` takes minutes, so a vulnerability surfaces before the long gate runs. It composes `ci` rather than restating its stages, so a stage added to `ci` joins the pre-push run too.

The audit reaches the network. With no network, `ci` is the gate that still runs.

Neither is bound to a git hook. `prepush` is named for when you run it, not for a hook nmr installs.

#### Check and quality

| Command        | Runs                                            |
| -------------- | ----------------------------------------------- |
| `check`        | `typecheck`, `fmt:check`, `lint:check`, `test`  |
| `check:strict` | `typecheck`, `fmt:check`, `lint:strict`, `test` |

Neither gate computes coverage: Instrumentation multiplies the wall time of the run they exist to keep short. Coverage is [`test:coverage`](#test-selections), run as a step of its own; a repo that wants it inside the gate [overrides](#configuration) `check:strict`.

#### Fix

| Command     | Runs                      |
| ----------- | ------------------------- |
| `fix:check` | `fmt:check`, `lint:check` |

#### Test

The same six names the workspace registry carries, so a command means the same thing from the monorepo root as from inside a package. Each fans out to root-level files and every workspace package.

| Command         | Runs                                           |
| --------------- | ---------------------------------------------- |
| `test`          | `root:test`, `-R test`                         |
| `test:all`      | `root:test:all`, `-R test:all`                 |
| `test:coverage` | `root:test`, `-R test:coverage`                |
| `test:tool`     | `root:test:tool`, `-R test:tool`               |
| `test:unit`     | `root:test:unit`, `-R test:unit`               |
| `test:watch`    | `vitest --project unit --project tool --watch` |

`test:coverage` chains `root:test` rather than a `root:test:coverage`, because the root config reports no coverage of its own; packages cover their own sources.

`test:watch` is the exception to the fan-out shape, and deliberately omits `--config`: bare `vitest` at the monorepo root resolves the root `vitest.config.ts`, whose projects then cover the whole tree in one process. A chain like the others would never advance past its first watcher. To watch root-level files alone, run `nmr root:test --watch`.

#### Typecheck

| Command     | Runs                             |
| ----------- | -------------------------------- |
| `typecheck` | `root:typecheck`, `-R typecheck` |

#### Lint

The lint commands respect each package's own `eslint.config.*`. Use the `root:` variants below to lint root-level code alone.

Requires `eslint` >= 10 and, for `lint:strict`, `@williamthorsen/strict-lint` >= 9.3.0.

| Command       | Runs             |
| ------------- | ---------------- |
| `lint`        | `eslint --fix .` |
| `lint:check`  | `eslint .`       |
| `lint:strict` | `strict-lint`    |

The run never enters a package, so per-package `lint:pre` and `lint:post` hooks do not fire from the root. They still run from inside the package and under `nmr -F <package> lint`.

#### Format

| Command     | Runs              |
| ----------- | ----------------- |
| `fmt`       | `nmr-fmt --write` |
| `fmt:check` | `nmr-fmt --check` |

#### File selection

`fmt` and `fmt:check` format the files git reports: tracked files, plus untracked files git does not ignore. Prettier reads `.gitignore` and `.prettierignore` from the working directory alone, so a pattern in `packages/<pkg>/.gitignore` never reaches a run started at the monorepo root. git knows the whole hierarchy, including `.git/info/exclude` and `core.excludesFile`, and every `.prettierignore` in the tree is discovered from the repository root, so package-level exclusions apply from any directory as well.

A file git ignores is never formatted, even when named directly. Trailing arguments are git pathspecs rather than Prettier flags, so `nmr fmt:check packages/nmr` narrows the run, while an unrecognized option and a pathspec matching no formattable file both fail it. Running outside a git repository fails rather than reporting a clean run.

#### Audit

| Command      | Runs                      |
| ------------ | ------------------------- |
| `audit`      | `audit:prod`, `audit:dev` |
| `audit:dev`  | `pnpm exec v11y --dev`    |
| `audit:prod` | `pnpm exec v11y --prod`   |

#### Dependencies

| Command   | Runs                                           |
| --------- | ---------------------------------------------- |
| `upgrade` | `nmr-report-overrides && nmr-taze --recursive` |

See [dependency upgrades](#dependency-upgrades) for the workflow and its configuration.

#### Root-only

These scripts operate on root-level code only (not workspace packages):

| Command            | Runs                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `root:check`       | `root:typecheck`, `fmt:check`, `root:lint:check`, `root:test`           |
| `root:lint`        | `eslint --fix --ignore-pattern 'packages/**' .`                         |
| `root:lint:check`  | `eslint --ignore-pattern 'packages/**' .`                               |
| `root:lint:strict` | `strict-lint --ignore-pattern 'packages/**' .`                          |
| `root:test`        | `vitest --config ./vitest.root.config.ts --project unit --project tool` |
| `root:test:all`    | `vitest --config ./vitest.root.config.ts`                               |
| `root:test:tool`   | `vitest --config ./vitest.root.config.ts --project tool`                |
| `root:test:unit`   | `vitest --config ./vitest.root.config.ts --project unit`                |
| `root:typecheck`   | `tsgo --noEmit`                                                         |
| `root:upgrade`     | `nmr-report-overrides && nmr-taze`                                      |

#### Utilities

| Command            | Runs                   |
| ------------------ | ---------------------- |
| `report-overrides` | `nmr-report-overrides` |

## CLI reference

### `nmr`

```
nmr [flags] <command> [args...]
```

Position determines ownership: flags before the command name are nmr's own, and everything after the command name is forwarded untouched to the resolved command.

| Flag                     | Description                                                    | Default |
| ------------------------ | -------------------------------------------------------------- | ------- |
| `-F, --filter <pattern>` | Run command in matching packages                               | —       |
| `-R, --recursive`        | Run command in all packages                                    | —       |
| `-w, --workspace-root`   | Use root scripts, running at the monorepo root                 | —       |
| `-q, --quiet`            | Suppress command output, keeping nmr's verdicts                | —       |
| `--json`                 | Report one JSON object per command, withholding command output | —       |
| `--log`                  | Print the recorded run instead of running it                   | —       |
| `--no-cache`             | Run even if this tree already passed; record the result        | —       |
| `-?, --help`             | Show available commands                                        | —       |
| `-V, --version`          | Show version number                                            | —       |

### Examples

```bash
# From a package directory
nmr test  # Run workspace test script
nmr build # Compile to .js and .d.ts

# From the monorepo root
nmr test    # Root tests + recursive workspace tests
nmr ci      # build + check:strict
nmr prepush # audit + ci

# Target specific packages
nmr --filter core test # Test only the core package
nmr --recursive lint   # Lint all workspace packages

# Force root context from anywhere
nmr --workspace-root check # Run root check from a package dir
```

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

## Agent guidance

nmr ships the rules an agent needs in order to invoke it, as [CodeAssembly](https://github.com/williamthorsen/codeassembly) package content. Adopt it by naming the package in the consuming repo's `.agents/codeassembly.yaml`:

```yaml
packages:
  use:
    - '@williamthorsen/nmr'
```

Then add `codeassembly` as a devDependency and run `codeassembly sync`. The guidance is injected into the machine-local guidance file each harness loads at launch; nothing is copied into the repo or committed there. It resolves from the installed package, so upgrading nmr updates it with no second step.

Wiring the sync to `postinstall` keeps it current without a hand-run command:

```json
{
  "scripts": {
    "postinstall": "codeassembly sync --warn-only"
  }
}
```

`--warn-only` reports a sync failure and exits 0; without it, a failed sync aborts `pnpm install`.

### Migrating from `sync-agent-files`

The `nmr sync-agent-files` command, its `nmr-sync-agent-files` bin, and the `check:agent-files` script were removed in favor of the above. After upgrading, delete the generated `.agents/nmr/` directory and the `@nmr/AGENTS.md` line it was exposed through, drop `check:agent-files` from any `check:strict` override that enumerates it, and remove any direct call to the bin.

## Standalone utilities

### `nmr-clean`

Remove a package's build output (`dist`) and its `nmr-compile` cache entry, leaving no state behind for the next build to skip on. Run from a package directory it cleans that package; run from the monorepo root it sweeps every workspace package in a single pass, running each package's resolved `clean` — so a package that overrides `clean`, in `.config/nmr.config.ts` or in its own `package.json`, gets its own command rather than the sweep. Removal is idempotent — cleaning an unbuilt package is a silent no-op. This is the default `clean` script at both levels.

```bash
nmr-clean
```

### `nmr-compile`

Compile a single package's `src` tree to `dist/esm` with the TypeScript compiler API, emitting `.js` from one program and `.d.ts` from a second that reuses it. The package's own `removeComments` governs the `.js` emit; the declarations emit forces it off, so `.d.ts` files carry their doc comments either way. Because the compiler parses each source file, every relative import form — static, re-export, dynamic `import()`, and bare side-effect — is rewritten from `.ts` to `.js` in both outputs, and `.ts` occurrences inside strings and comments are left intact. tsconfig `paths` aliases are resolved to runnable relative `.js` specifiers in both outputs, sourced from the package's tsconfig. An aliased import whose target resolves outside the package's `src/` and is not resolvable without the alias mapping fails the build with a diagnostic, rather than being emitted verbatim to produce output that fails at runtime. The build is skipped when no input has changed and the previous output is still on disk (the key is cached under `node_modules/.cache/nmr-compile/`, outside the published output). Deleting the output by any means — `nmr clean`, `rm -rf dist`, `git clean` — therefore forces a rebuild rather than a skip. This is the default `compile` script — run it from a package directory.

**What it compiles.** Entry points are `src/**/*.ts` less the directories that hold test scaffolding rather than shipped code: `__fixtures__/`, `__mocks__/`, `__tests__/`, and `test-utils/`. Add to that list per package with [`build.extraIgnorePatterns`](#package-level-configuration). Ignoring a directory drops it as an _entry point_, not from the emit: the compiler still emits whatever the surviving entry points import, so a helper that production code uses is still compiled and its importer never emits a dangling specifier. This list is deliberately not the Vitest [coverage exclusions](#what-the-config-excludes) — helpers live in `test-utils/` precisely so they stay covered.

**The build owns its output directory.** Every rebuild replaces `dist/esm` wholesale, so the directory holds exactly the current emit: a source that was deleted, or that a widened ignore set now covers, leaves nothing behind. Assets therefore belong outside the output directory, or in a `build:post` hook, which runs after the output is published and so composes correctly. Note that a bare `nmr compile` runs no hook, so assets a `build:post` step copies in are absent until a full `nmr build` restores them. An `outdir` that does not resolve inside the package is rejected rather than replaced.

**The replacement is atomic.** The emit is buffered in memory, written to a staging directory beside the output directory, and swapped into place by rename. A build that fails for any reason -- a malformed tsconfig, an unresolvable alias, a full disk -- therefore leaves the previous output exactly as it was. `dist/esm` is never observed mid-write: it holds the previous build or the new one, and is absent only between the two renames. This matters most when the package being rebuilt supplies a binary that other packages in the same recursive build invoke.

**What busts the cache.** The key folds each input's content and path, the emit options, the resolved TypeScript version, and a fingerprint of the nmr running the build -- its own build digest in a workspace checkout, its package version otherwise. Upgrading nmr in a consuming repo therefore rebuilds every package nmr compiles, and an edit to nmr's own build sources rebuilds each sibling once nmr itself has been rebuilt. A build of nmr's own package folds the version rather than the digest, which is the cache entry that build is about to write.

`typescript` is a peer dependency (`>=5.7.0 <7`); the consuming repo provides it. The floor is what `rewriteRelativeImportExtensions` requires; the ceiling is because TypeScript 7 ships no compiler API — its root export is a version constant, so `nmr-compile` cannot run on it. Relative imports in source must carry explicit `.ts` extensions for them to be rewritten.

```bash
nmr-compile
```

### `nmr-fmt`

Format, or check the formatting of, the files git reports for the working directory. Exactly one of `--check` and `--write` is required; a bare invocation prints usage and exits non-zero rather than defaulting to a mutation. `--write` also lists the files it rewrote. This is what `fmt` and `fmt:check` resolve to, in both registries.

The selection is tracked files plus untracked files git does not ignore, scoped to the working directory, with every `.prettierignore` in the tree discovered from the repository root and passed to Prettier explicitly — see [file selection](#file-selection) for what that buys. Paths the index names but the filesystem does not have (a file deleted but not yet staged) and submodule gitlinks are both dropped, so neither reaches Prettier.

Trailing arguments are git pathspecs, not Prettier flags: they narrow the selection, an unrecognized option is rejected rather than forwarded, and pathspecs that match no formattable file fail rather than passing quietly.

`prettier` is an optional peer dependency (`>=3.9.5 <4`); the consuming repo provides it, and it is resolved through the module graph rather than from `PATH`, so the copy that runs is the one the repo declares and not whichever `prettier` happens to come first. A repository's formatter has to be the one its editor and pre-commit hook also run, which is why nmr takes it from the consumer instead of bundling a copy. It is optional because a repo can use nmr purely as a script runner; one that formats without a resolvable Prettier gets a message naming the package and the range.

The floor is a currency policy, not a capability boundary. What the design requires is `--ignore-path` honouring every flag rather than only the last, so a repository-root ignore file passed alongside a package-level one is not silently dropped — Prettier has done that since 3.0.0, while 2.x honoured only the final flag. The floor sits at the current release because every consuming repo tracks it; lowering it to `>=3.0.0` would cost correctness nothing.

```bash
nmr-fmt --check
nmr-fmt --write packages/nmr
```

### `nmr-taze`

Run the [taze](https://github.com/antfu-collective/taze) dependency-upgrade tool, forwarding every argument to it untouched and adding one of its own: a 30-second request timeout, unless the invocation already carries one. This is what every `upgrade` chain ends with, `root:upgrade` included — see [dependency upgrades](#dependency-upgrades) for the workflow, and [request timeout](#request-timeout) for why the timeout is set here.

Under pnpm's isolated `node_modules`, a transitive package's binary is absent from the consuming repo's `node_modules/.bin`, so a repo that depends on nmr cannot run `taze` directly. `nmr-taze` can, because nmr is a direct dependency, and it resolves the tool from the tree nmr controls.

```bash
nmr-taze --recursive
```

### `ensure-prepublish-hooks`

Verify that all publishable workspace packages have a `prepublishOnly` script. Exits non-zero if any are missing.

```bash
ensure-prepublish-hooks
```

| Flag                  | Description                   | Default           |
| --------------------- | ----------------------------- | ----------------- |
| `--fix`               | Add missing hooks             | —                 |
| `--dry-run`           | Preview what `--fix` would do | —                 |
| `--command <command>` | Custom hook command           | `"npm run build"` |

## Conformance checks

nmr publishes a `readyup` kit that checks a consuming repo against the current release: the shared Vitest and Prettier configs, the workspace layout, the root script registry, the [test-tier convention](#test-tiers), and that no `package.json` in the tree declares a `pnpm` field, which pnpm 11 reads no key from. Those settings belong in `pnpm-workspace.yaml`, and `pnpx codemod run pnpm-v10-to-v11` moves them. The kit ships inside the package, so it checks against the nmr version installed rather than whatever a repository ref happens to point at, and a tier added or renamed in nmr reaches the repo on upgrade. A repo that wants the tier convention in its own gate rather than in a command run by hand declares the [conventions check](#gating-the-test-file-conventions) instead, which also covers the half the kit does not.

Add `readyup` as a devDependency, then name nmr in its config:

```ts
// .config/readyup.config.ts
import { defineRdyConfig } from 'readyup';

export default defineRdyConfig({
  packages: ['@williamthorsen/nmr'],
});
```

```bash
rdy run --packages                       # every kit each listed package publishes
rdy run --from npm:@williamthorsen/nmr   # nmr's kit alone, without the config entry
rdy list --from npm:@williamthorsen/nmr  # what nmr publishes
```

`--packages` is the form that survives nmr publishing further kits. Both need `readyup` 0.23 or later, and `@williamthorsen/nmr` as a _direct_ devDependency: a strict pnpm layout links nothing else into the project, so a transitive copy is unreachable.

## Consumer migration

After installing, a consuming repo's root `package.json` scripts shrink to lifecycle hooks:

```json
{
  "prepare": "lefthook install"
}
```

Per-package `package.json` files no longer need script entries. Run `nmr <command>` directly.

## Workspace introspection

Repo-wide tests and scripts often need to know where the monorepo root is, or which directories its workspace packages live in. The `@williamthorsen/nmr/workspace` subpath publishes the two pnpm-workspace lookups nmr uses internally:

```ts
// __tests__/packages.test.ts
import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';

const monorepoRoot = findMonorepoRoot();

for (const packageDir of getWorkspacePackageDirs(monorepoRoot)) {
  // assert something about every workspace package
}
```

`findMonorepoRoot(startDir?)` walks up from `startDir`, defaulting to `process.cwd()`, until it reaches a directory containing `pnpm-workspace.yaml`. It throws if it runs out of parent directories without finding one.

`getWorkspacePackageDirs(monorepoRoot)` reads the workspace patterns from that repo's `pnpm-workspace.yaml` and resolves them to absolute package directories, sorted and free of duplicates. It throws if `monorepoRoot` holds no `pnpm-workspace.yaml`. Patterns carry pnpm's own semantics: `packages/*`, deeper globs such as `packages/**`, exact paths such as `tools/cli`, and `!`-prefixed exclusions such as `!packages/legacy` or `!**/test/**`, which filter every directory the positive patterns matched regardless of where they appear in the list. Nothing under `node_modules` is ever returned.

One divergence from pnpm: a directory counts as a package only if it holds a `package.json`, not a `package.yaml` or `package.json5`.

Quote exclusion patterns in the manifest — `- '!packages/legacy'`. An unquoted `!` opens a YAML tag rather than a string, so the entry never reaches nmr (or pnpm) as a pattern.

## Shared Prettier config

Every repo consuming nmr otherwise maintains its own copy of the house Prettier options, and wires up shell formatting itself. The `@williamthorsen/nmr/prettier` subpath publishes both as a factory, so a repo declares only what it customizes:

```js
// .prettierrc.js
import { definePrettierConfig } from '@williamthorsen/nmr/prettier';

export default definePrettierConfig();
```

`prettier` is a peer dependency (`>=3.9.5 <4`), declared optional — the consuming repo provides it. The shell and Dockerfile plugin is a dependency of nmr rather than a peer, so its version is pinned centrally and two repos cannot format the same script differently.

### What it formats

Beyond everything Prettier already handles, this config formats `.sh`, `.bash`, `.zsh`, and the other extensions and dotfile names of the Shell language, plus `Dockerfile` and `Containerfile`. `nmr fmt` therefore covers shell scripts with no extra script, glob, or workflow entry.

Shell output matches `shfmt` run with no flags: `binaryNextLine`, `spaceRedirects`, and `switchCaseIndent` are pinned to shfmt's CLI defaults, which the underlying plugin inverts. A repo whose scripts shfmt already formatted sees no diff on adoption.

Code fences inside Markdown are left alone, in every language rather than shell alone. Registering the shell plugin also routes a fence tagged `bash` to shfmt, where a documented command's angle-bracket placeholders are valid redirections: `cmd --type <type> --harness claude` is reprinted as `cmd --type claude <type >--harness`, which still runs but no longer does what it documents. It cannot be narrowed back to shell, because Prettier matches a fence tag against the same `extensions` its file inference reads, so the `.bash` routing a script also claims the tag `bash`.

### Language scoping

`prettier-plugin-sh` routes 20 further file types to the same shell parser, among them `.gitignore`, `.env`, `.csh`, `.nu`, `.properties`, `.ics`, `.vcf`, `CODEOWNERS`, and `hosts`. Since `nmr fmt` hands git's whole file list to Prettier, registering the plugin as shipped would make every one of them formattable — and the shell parser either fails on them or silently rewrites them. A `.gitignore` pattern such as `a(b)c` fails to parse, and an unquoted `&` in a `.env` or `.properties` value is split across two lines.

This config registers a narrowed plugin, so Prettier infers a parser for the Shell and Dockerfile languages alone. `.flaskenv`, `gradlew`, and `mvnw` are dropped from Shell as well: the first holds dotenv content the plugin misfiles as shell, and the other two are vendored wrappers their generators would overwrite.

The parsers themselves stay registered, so a repo that wants a dropped language back assigns it explicitly:

```js
export default definePrettierConfig({
  additionalOverrides: [{ files: ['APKBUILD', '*.ebuild'], options: { parser: 'sh' } }],
});
```

### Customizing

Any Prettier option passed to the factory spreads over the defaults:

```js
export default definePrettierConfig({
  printWidth: 100,
  additionalPlugins: [await import('prettier-plugin-tailwindcss')],
  additionalOverrides: [{ files: ['*.md'], options: { proseWrap: 'always' } }],
});
```

`additionalPlugins` and `additionalOverrides` append to what the config declares, so a later override wins over nmr's own and no seam can drop shell support. Passing `plugins` or `overrides` throws, and both are typed `never` — replacement is inexpressible rather than merely discouraged, because a silently ignored key would produce no diff to notice.

### Adoption caveats

- **Indentation follows `.editorconfig`**, as it did under shfmt: Prettier maps `indent_style` and `indent_size` to `useTabs` and `tabWidth`, and the plugin honours both. With no `.editorconfig`, the two disagree — shfmt indents shell with tabs, Prettier with two spaces. Add `indent_style = tab` under `[*.sh]` to keep tabs.
- **Markdown fences stop being tidied.** The carve-out that protects documented shell commands costs the `ts`, `json`, and `yaml` fences their formatting too. Fences already formatted stay as they are, so nothing churns on adoption; new ones are simply left as written. A repo whose docs hold no shell can take them back for the Markdown paths it actually uses: `additionalOverrides: [{ files: ['*.md'], options: { embeddedLanguageFormatting: 'auto' } }]` restores `.md` alone, and the carve-out still covers every other path Prettier reads as Markdown.
- **Adopting the house options reformats the repo.** `singleQuote`, `trailingComma`, and the rest apply on the first run; review that diff separately from the shell one.

## Shared Vitest config

Every repo consuming nmr otherwise writes and maintains its own Vitest config. The `@williamthorsen/nmr/vitest` subpath publishes that config as a factory, so a repo declares only what it customizes:

```ts
// vitest.config.ts
import { defineVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineVitestConfig();
```

`vitest` is a peer dependency (`>=4.0.0 <5`), declared optional — the consuming repo provides it, and repos that never import this subpath are unaffected. `vite` is an optional peer as well (`>=8.0.0 <9`), required only by the [`tsconfigPaths` setting](#resolving-through-tsconfig-paths); a repo that declares a `vite` of its own below that range sees an unmet-peer warning whether or not it sets the flag.

### Test tiers

The config declares four projects, an ordered ladder named for the furthest thing a test reaches:

| Project     | Matches                                | Reaches                                              |
| ----------- | -------------------------------------- | ---------------------------------------------------- |
| `unit`      | every test file the others don't claim | nothing outside the package's own dependency closure |
| `tool`      | `*.tool.test.{ts,tsx}`                 | a program the environment must supply                |
| `localhost` | `*.localhost.test.{ts,tsx}`            | a service running on this machine                    |
| `remote`    | `*.remote.test.{ts,tsx}`               | a machine that isn't this one                        |

All four match only under a `__tests__` directory. Select them at run time with `--project`, which unions when repeated and accepts negation:

```bash
vitest --project unit --project tool # everything that runs on a bare install
vitest --project tool                # tests reaching a program, alone
vitest                               # every project
```

**A tier names what a test reaches, never how it invokes it.** A test driving a compiler through its JavaScript API is `tool`, exactly as one spawning the compiler binary is; whether a program ships as a library or an executable is an accident of packaging, not a property of the test. A package's `peerDependencies`, plus whatever binaries it spawns, are a good statement of where its `tool` boundary sits: a bundled dependency ships inside the package's own closure and is always present, so reaching one is `unit`.

**A tier is not a statement about preconditions.** A `unit` test may still need something set up before it runs: a build, a generated fixture, a seeded file. What makes it `unit` is that it reaches nothing beyond the test process _while running_. The filesystem sits in `unit` for the same reason the tiers exist: they gate on what must be available, and the filesystem always is.

**Every test file names its tier**, in the form `<subject>[.<aspect>].<tier>.test.ts`. Only the segment immediately before `.test.` selects a project, so an earlier one is free for documentation: `resolveConfig.packaged.unit.test.ts` reads as a companion to `resolveConfig.unit.test.ts` and still names `unit`.

`unit` is defined by subtracting the tiers rather than by an allow-list of infixes, so a file such as `parser.smoke.test.ts` runs under `unit` instead of being silently dropped. That is a safety net, not a licence to omit the tier: a file whose tier segment is missing or misspelt runs under `unit` and reports success, so no test run distinguishes it from a conformant one until the repo declares the [conventions check](#gating-the-test-file-conventions). In a repo that has not, [nmr's readyup kit](#conformance-checks) is what reports those files.

`localhost` and `remote` have no test script of their own. They are declared anyway, so that a `*.remote.test.ts` file cannot fall into `unit` and run in the default gate unnoticed.

Every tier above `unit` carries a 30-second `testTimeout` and `hookTimeout`, where `unit` keeps Vitest's defaults of 5 and 10 seconds. A tier test waits on something it doesn't control, and coverage instrumentation multiplies that wait, so the defaults turn a green suite flaky the moment `nmr test:coverage` collects it. Both budgets move together because a tier that scaffolds in `beforeAll` moves that wait out from under `testTimeout` entirely, where raising the test budget alone never reaches it. `unit` keeps the tight budgets, which is what makes a hung unit test fail fast.

To raise a budget for one tier and no other, use the `tiers` seam below. The `project` seam merges over both budgets as well, but like every option passed through it the value reaches all four projects at once -- raising a tier's budget raises `unit`'s with it. To lift the ceiling for a single file rather than a whole tier, pass a timeout to the individual test or hook, which stays the narrower tool.

### Gating the test-file conventions

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

### What the config supplies

Two settings a workspace test runner needs almost universally are part of what the factory produces, so a config file declares neither:

- **Workspace packages resolve from source.** `source` leads the emitted `resolve.conditions` and `ssr.resolve.conditions`, so a cross-package import reaches the dependency's `.ts` rather than its `dist/` and a suite runs without a prior build. A package declaring no such condition is unaffected.
- **Git subprocesses are isolated.** Every project loads a setup file that points `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at the null device and sets `GIT_CONFIG_NOSYSTEM`, so a test that spawns `git` reads neither the developer's identity nor a signing config that can block on a passphrase. It leads each project's `setupFiles`, ahead of every entry the layers add, because a shared setup establishes the environment the rest run in.

Both defaults exist because omitting either is silent rather than loud: the tiers still exist and the suite still runs green, testing `dist/` and the developer's git identity instead. Turn either off through its own option, which folds across layers like any other, the last layer to declare it winning:

```ts
export default defineVitestConfig({ isolateGit: false, resolveFromSource: false });
```

`resolveFromSource: false` is for a repo that resolves a `source` condition it does not want in tests; `isolateGit: false` is for a suite meant to read the developer's own git configuration.

**Vite replaces its condition defaults rather than extending them.** A config writing `conditions: ['source']` by hand therefore drops `module`, so a dependency exposing a `module` entry falls through to whatever its `exports` lists next. A replaced list still resolves `node` and `development` under Vitest, which is why nothing in a test run reports the loss. The factory emits `source` alongside Vite's defaults for each environment, so a config declaring no conditions of its own starts from a complete list.

**A package declaring a `source` condition must ship its sources.** Every nmr consumer now resolves that condition, so a published package whose `files` carries `dist` alone resolves to a path that is not in the tarball. A package that publishes only its build output takes a bespoke condition name instead, the way `@williamthorsen/nmr-core` uses `nmr-source` for the build's own bootstrap.

### Resolving through tsconfig paths

A third resolution setting sits alongside those two, and this one is off. `tsconfigPaths: true` emits Vite's `resolve.tsconfigPaths`, so a test reaches an aliased specifier through the `paths` its `tsconfig.json` declares, the way `tsc` does:

```ts
export default defineVitestConfig({ tsconfigPaths: true });
```

It folds across layers like the other two, the last layer to declare it winning. It needs no `ssr` counterpart the way a condition does: Vite holds this setting outside its per-environment resolve options, so the single key reaches the environment a test's own imports resolve through.

**It is an opt-in because its silent direction is the reverse of the two defaults'.** Leaving it off fails loudly, with an unresolved import naming the specifier. Turning it on is the silent direction, for a repo that declares `paths` for `tsc` alone: a specifier that resolved through a package's `exports` starts resolving through the alias instead, and nothing in the run reports the switch. A repo declaring no `paths` is unaffected either way.

**It requires Vite 8**, where `resolve.tsconfigPaths` arrived. nmr declares `vite` as an optional peer at `>=8.0.0 <9`, so a repo holding a stale `vite` of its own hears about it at install time. That check does not reach a repo whose only Vite comes in through Vitest's own dependency, and Vitest 4 accepts Vite 6 and 7: on those, the emitted key does nothing and the aliased import fails exactly as it would with the flag off.

### Customizing by scope

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

`resolve.conditions` concatenates too, onto the `source` condition and the Vite defaults the factory already emits, but layer order carries no meaning there: Vite consumes conditions as a set, and which one wins is decided by the key order of the consumed package's own `exports`. A later layer can add a condition and can never remove or outrank one an earlier layer contributed; removing `source` is what `resolveFromSource: false` is for. `resolve.alias` is the one key that merges override-first, so a later alias takes precedence over an earlier one.

**A condition for the tests' own resolution goes under `ssr`.** `resolve` is per-environment, and Vitest resolves a test's imports through the server environment, so `root: { ssr: { resolve: { conditions: ['my-condition'] } } }` is the seam that reaches them. A top-level `root: { resolve: { conditions: [...] } }` entry reaches the client environment, which only browser-mode tests resolve through; it composes into that array and never reports that a node test did not see it. `resolve.alias` is not per-environment, so a top-level alias reaches both.

### Sharing options across config files

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

**A path in a shared layer must be absolute.** Vitest resolves `setupFiles` against each project's own root, not against the module that declared the path, so a bare `'./vitest.setup.ts'` in a shared module names a different file in every package that consumes it -- and a package that happens to own a file by that name loads the wrong one instead of failing. The co-located form stays correct in a config file that declares the path directly.

**Do not merge two returned configs.** `mergeConfig(defineVitestConfig(), defineVitestConfig(mine))` looks like the idiomatic recovery and fails at startup: both sides declare the same four project names, which Vitest rejects with `Project name "unit" ... is not unique`. Layers merge the factory's inputs instead, which is why they yield four projects however many fold.

A config file that omits the shared layer still loses those settings, silently -- Vitest's own resolution contract, not something the factory can intercept. Guard it with a test that fails when a package's suite goes missing, which also catches a shared `exclude` pattern swallowing one package's tests. Source resolution and git isolation need no such guard: the factory supplies both, so a config file cannot omit them by forgetting a layer.

### What the config excludes

Collection skips `**/node_modules/**`, `**/.git/**`, `**/coverage/**`, and `**/dist/**`. Coverage skips `**/__{fixtures,mocks,tests}__/**`, `**/index.ts`, and `**/*.d.ts`.

`testCollectionExclude` adds to the collection list. It takes directory basenames rather than globs, matched at any depth, so the same array serves the [conventions check](#gating-the-test-file-conventions):

```ts
export default defineVitestConfig({ testCollectionExclude: ['cypress', 'generated'] });
```

Every layer's entries are concatenated, and a name the shared config already prunes is emitted once. A repo needing a glob rather than a directory name has the `project` seam's own `exclude`.

Because both seams concatenate, a consumer can add an exclusion but never remove one. A pattern therefore earns its place in these lists only by preventing a _silent_ failure, one a consumer cannot self-diagnose. A visible failure, such as a stray file sitting at 0% in the coverage report, is left to the consumer's own `project` seam.

Excluding build output from collection is the clearest case. A build that copies `.ts` sources rather than compiling them puts a second copy of the suite under `dist/`, where it is collected and passes green against stale code, and nothing in the run says so. (`nmr build` emits only `.js` and `.d.ts`, neither of which the include matches, so an nmr-built package was never exposed.) `dist/` is deliberately absent from the coverage list, because build output reaching a coverage report shows up as a diagnosable 0% entry.

#### Where to put fixtures

A `__fixtures__/` directory is excluded from coverage at any depth, so fixture data stops counting against a package's numbers whether or not a test imports it.

Placing it outside `__tests__/` settles a second problem: anything named `*.test.{ts,tsx}` under `__tests__/` is collected and run, whatever it holds, so a fixture carrying that name becomes a failing test. `src/__fixtures__/` resolves both halves; `src/__tests__/__fixtures__/` resolves the coverage half alone.

No collection pattern names fixtures, and that asymmetry is intentional. A coverage exclusion cannot hide a real test, whereas a collection exclusion can; since it could not be removed, a consumer who legitimately keeps a test under `__fixtures__/` would have no recourse.

### Root-scoped tests

A monorepo's own root-level tests need a second config, because the package config is found by walking up from a package directory:

```ts
// vitest.root.config.ts
import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });
```

This variant reads `pnpm-workspace.yaml` and excludes every workspace package from all four projects, so a root run covers only root-level files. It reports no coverage of its own — packages cover their own sources.

`monorepoRoot` is required, and because the config sits at the monorepo root, it is always `import.meta.dirname`. Stating the root rather than searching for it is what makes the exclusions describe this repo: a search from the working directory would resolve whichever monorepo the run started in, and every project is then pinned to that one. A directory holding no `pnpm-workspace.yaml` throws, naming the directory.

### Migrating to the isolation tiers

The projects were once named `unit`, `integration`, and `app`, for what a test _covered_ rather than what it _reached_. `integration` and `app` are gone.

1. Rename every `*.int.test.ts`. A test that reaches a program the environment supplies becomes `*.tool.test.ts`; one that reaches nothing beyond the test process becomes `*.unit.test.ts`. Re-read each file rather than renaming in bulk -- the axis changed, so the old bucket does not map onto one new tier.
2. Rename every `*.app.test.ts` onto the convention. `app` was never a tier, so keep it as the aspect segment and add the tier after it: `scaffold.app.test.ts` becomes `scaffold.app.unit.test.ts`.
3. Replace `nmr test:integration` with `nmr test:tool`, and `nmr root:test:integration` with `nmr root:test:tool`, wherever a script or workflow names them.

**A file left without a tier is a silent failure.** The residual `unit` claims it and it runs in the default gate -- green, with nothing reporting that the separation was lost. Declare the [conventions check](#gating-the-test-file-conventions), which turns that state into a failing test run, or run [nmr's readyup kit](#conformance-checks), which reports every such file. Do one of the two before treating the migration as done.

`nmr test` also runs the `tool` tier, which the old `test` excluded. Those tests previously ran in no default selection at all: `check`, `check:strict`, and `ci` all inherited the exclusion, so a green pipeline said nothing about them. Expect `nmr test` to take longer and to surface failures that were never gated.

### Migrating from the config-file variants

nmr once selected a package's test scripts by looking for a `vitest.integration.config.ts` on disk, which meant three config files per package that separated its integration tests. Those files are no longer consulted.

1. Replace the repo's root `vitest.config.ts` with `defineVitestConfig()`, and its root-scoped config with `defineRootVitestConfig({ monorepoRoot: import.meta.dirname })`.
2. Delete every `vitest.integration.config.ts` and `vitest.standalone.config.ts`, plus any per-package `vitest.config.ts` that only re-exports an ancestor. Vitest resolves config by walking up from the run root, so those are redundant.
3. Rename the tests onto the tiers, per the section above.
4. Drop any hand-copied `test*` entries from `package.json`, which now shadow the defaults.

Until step 1 is done, every test command that names a tier fails against a config declaring no projects, with `Error: No projects matched the filter "unit", "tool".` at startup. `test:all` is the exception: it names no project, so it runs everything the config collects.

That is a change for the better. While `test` selected by negation, an unmigrated config produced a _green_ run, because `--project '!integration'` had nothing to exclude, so the separation was lost with no error anywhere. Positive selection turns the same state into a startup failure that names the missing projects.

### Migrating a repo that layered source resolution or git isolation by hand

The factory supplies both, so the layer a repo wrote for them, and any guard test that checked every config file imported it, can go.

1. Delete the shared module's `resolve.conditions` entry for `source` and its `ssr.resolve` twin. Keep the module for whatever else it carries; delete it outright once it carries nothing.
2. Delete the git-isolation setup file and its `setupFiles` entry. nmr's runs in its place, ahead of every entry a layer adds.
3. Delete the test that asserted each config file imports the shared module, where the module is gone.

Two behaviors change on upgrade even in a repo that layered neither.

A suite whose tests run `git commit` while relying on the developer's global identity now fails with git's own `Please tell me who you are`. Set the identity locally in the fixture repo the test builds -- `git -C <repo> config user.email`, `user.name`, and `commit.gpgsign false` -- which is what makes the test report the same result on every machine.

A workspace package declaring a `source` condition is now resolved from source in tests that previously read its `dist`. That is the point of the default, and it means a suite stops exercising build output it may have been exercising by accident.
