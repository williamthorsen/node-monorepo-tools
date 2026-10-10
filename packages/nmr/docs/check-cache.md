# Check-result cache

How nmr skips a check that already passed on the same working tree, what decides a hit, and how to read, bypass, and configure what it recorded.

The [README](../README.md#check-result-cache) shows a skip in action.

Composite commands expand into child `nmr` processes, so one green `nmr ci` records a pass for every cacheable command in the chain, at every scope at which it ran. A later `nmr check`, `nmr typecheck`, or `nmr -F core test` on the same tree skips too. The skip is [reported](reporting.md#what-nmr-reports) in every verbosity.

The cache is a working-tree cache, not a build cache: It answers "has this exact tree already passed this check?" and nothing else. It is also local to one checkout (the install fingerprint in its key is machine-specific), so it saves repeated work in a working copy rather than sharing results across machines or with CI.

## What is cached

Cacheable by default: `check`, `check:strict`, `ci`, `fix:check`, `fmt:check`, `lint:check`, `lint:strict`, `test`, `test:coverage`, `test:tool`, `test:unit`, `typecheck`, and the `root:` variants `root:check`, `root:lint:check`, `root:lint:strict`, `root:test`, `root:test:tool`, `root:test:unit`, and `root:typecheck`.

Everything else runs every time:

| Command                         | Why it is never skipped                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit`, `prepush`              | Consult a vulnerability database that changes independently of the tree. `prepush`'s `ci` constituent still skips while its `audit` runs every time. |
| `build`, `compile`              | Have a cache of their own.                                                                                                                           |
| `fix`, `fmt`, `lint`, `upgrade` | Rewrite the tree that they were asked about, so a recorded pass would describe a tree that no longer exists.                                         |
| `test:all`                      | Reaches the `localhost` and `remote` tiers, which the environment supplies rather than the tree.                                                     |

## The exit-status-only contract

**A cacheable name promises that its whole contribution is an exit status**, through its entire chain, `:pre` and `:post` hooks included. A hit skips that chain wholesale, so any file that a cacheable command was relied on to produce will not appear.

`test:coverage` is cacheable on exactly this reading: It contributes the pass, not the `coverage/` directory, which a skipped run leaves as whatever the last real run wrote. After a `test:coverage` that may have skipped, `coverage/` may be stale; `--no-cache` forces a fresh one.

Overriding a cacheable name, in `package.json` or in `workspaceScripts`, inherits its cacheability. An override that writes something anyone depends on belongs in `excludeCommands`.

## What the key is made of

A hit requires all of these to match the run that recorded the pass:

- **The working tree's content**, hashed from the commit's tree object folded with the current content of every path that git reports as changed or untracked. Timestamps are not content, so a `touch` that does not rewrite any bytes leaves the hash alone.
- **The command string that would run**, hooks and all, and the scope in which it would run.
- **nmr's version**, the **Node version**, and the **platform and architecture**.
- **What pnpm has installed.** An install, a prune, or a lockfile change forces a re-run.
- **`TZ`, `LANG`, `LC_ALL`, and `NODE_OPTIONS`.** This set is fixed, so two machines that differ only in other environment variables still agree.

A hit additionally requires the build output of every package that nmr's own build covers to be present, and to have been built from this tree. Because output is git-ignored, neither its removal nor its replacement changes the hash: Restoring a tree with `git stash` or `git checkout` does not restore any of the output with which that tree was built. nmr compares each covered package's recorded build digest against the one on disk, and treats a `dist` compiled from another tree as a miss that the following run repairs. A package that overrides `build` or `compile` emits on terms that nmr does not know and is exempt.

A pass is recorded only when the command exits 0, only when the tree still matches the one against which the run started, only when every covered package's output is present and unchanged since the run started, and never for a run that executed nothing (a `""`/`":"` skip override, or an `NMR_RUN_IF_PRESENT` miss). When output changes mid-run, whether another process rebuilt it or the chain built it itself, nmr cannot tell over which output the pass was earned: `nmr ci` is the one default command whose chain builds its own output, and it does not record a pass on a run whose build did work. The `nmr check:strict` inside that chain still records a pass, because it starts after the build.

## Out of contract

These change what a check concludes without changing the hash. When one applies, exclude the affected command:

- **Content filters.** `core.autocrlf` and `.gitattributes` filters mean the bytes on disk differ from the bytes that git records; the hash follows what is on disk, but a checkout on another platform may not reproduce it.
- **Symlinked inputs.** A symlink is hashed by the path that it names, not by the content of its target.
- **Gitignored inputs.** Anything git does not report is invisible to the hash. The build-output probe is the one exception, and covers only nmr's own build.
- **`passWithNoTests`.** A suite that does not collect any files exits 0, and that pass is recorded like any other.

Committing an already-checked tree also changes the hash, because the commit's tree object is the base of the fold; the next run does the work again. The reverse holds and is useful: A rebase or an amended message that preserves content leaves the hash alone, as does checking out a branch whose tree is identical.

## When the cache does not apply

The gate never wrongly skips. When it cannot be sure, it does nothing and the command runs:

- Outside a git repository, when git fails, or when `HEAD` does not resolve to a commit.
- When the repository declares or contains submodules, whose content the hash does not cover.
- When the monorepo root is not the git toplevel.
- When a changed path cannot be read, or is neither a file nor a symlink (an untracked nested repository, for instance).
- When the repository does not have a pnpm install to fingerprint.
- Under a `devBin` substitution, which runs a binary built from a location that the hash does not describe.
- For any invocation carrying arguments after the command name, and for every step below it: the arguments narrow what runs, and a step served from a recorded pass is a step that did not.

`NMR_DEBUG=1` reports why a run did not skip and why the cache did not apply.

## Replaying a skipped run's output

A skip reports an excerpt of the run that it recalls, marked as a recording rather than as this run's output:

```console
$ nmr test
# ... the suite runs ...

$ nmr test
⏩ nmr: test: passed 2m ago on this tree, saved ~12s — replayed: Test Files 6 passed (6) Tests 41 passed (41)
```

The excerpt is the last blank-line-delimited block of what the command wrote, which is the closing statement that a tool separates from its progress output. It is flattened onto one line, with escape sequences stripped, table rules dropped, and a redrawn progress line reduced to what a reader was left looking at. nmr does not parse anything or compute any figure: It replays bytes that it recorded. A block wider than a few kilobytes is cut and marked with `…`, so a command whose closing statement is one long line cannot put its whole output in the cache.

The operation that records the pass also writes the excerpt and the whole transcript from which it is drawn. A pass that nmr declines to record because the tree or the build output changed leaves neither behind, and `nmr clean` clears both along with the passes to which they belong.

**nmr captures output at the command, and only when it can see that output.** A command whose stdout or stderr is a terminal writes to a stream that nmr never reads, so an interactive run retains nothing and its progress display is untouched; a piped or redirected run, and any run under `-q`, retains both streams. A composite passes its file descriptors to the child `nmr` processes below it and captures nothing of its own, and a `:pre` or `:post` hook contributes nothing to the command that it wraps: An excerpt is the command's own output or none.

**A composite replays its constituents' excerpts.** Capturing nothing of its own, a composite assembles what its constituents recorded, each line attributed to the scope and command that produced it:

```console
$ nmr check
⏩ nmr-core: check: passed 3m ago on this tree, saved ~48s — replayed: nmr-core: fmt:check: All matched files use Prettier code style!; nmr-core: test: Test Files 6 passed (6) Tests 41 passed (41)
```

The assembly is flat: A constituent that is itself a composite contributes its own leaves' lines, so a skipped `ci` replays a package's `test` rather than one opaque `check:strict` line. A delegate expands into the scopes to which it fans out, and a constituent that did not record an excerpt is absent rather than inferred: `typecheck` and `lint:check` print nothing on success and contribute nothing above, and a command outside the [cacheable set](#what-is-cached) records nothing at all. `ci` replays what `check:strict` earned and nothing for `build`.

Every excerpt in the assembly was certified during a single run, on a single tree, because nmr assembles it when the composite records its pass rather than when it skips. `NMR_RUN_ID` makes that provable; see [reserved environment variables](#reserved-environment-variables).

**A skip certifies what it replays.** Recalling a pass proves the excerpt describes this tree, and a matching retention key proves it describes this presentation environment, so a skip restamps the recalled entry with the run replaying it. A constituent already warm when a composite ran therefore still contributes its line: `nmr check` after `nmr test` replays the test summary. The restamp touches nothing else -- the instant and the duration belong to the run that earned the pass.

**A replay is held to more than the pass is.** Retention has its own key: the [pass key](#what-the-key-is-made-of) folded with the channel on which each output stream ran and with `CI`, `COLUMNS`, `FORCE_COLOR`, `NO_COLOR`, and `TERM`. `NMR_OUTPUT_STYLE` is in neither key, so a rich run and a plain one share a recorded pass and replay each other's excerpts as recorded. A recording made under a different one is recalled as a pass all the same; its excerpt is simply not replayed, and the verdict prints alone, as it does for a pass that retained nothing.

Because the whole line, excerpt included, is held to the same [512-byte ceiling](reporting.md#what-nmr-reports) as every verdict, one write still emits it whole under concurrent fan-out. An assembly wide enough to overrun it is cut and marked with `…` rather than spread over several lines.

## Reading a retained run

The excerpt is a line; nmr also keeps the run's whole transcript. `nmr --log <command>` prints that transcript after a header that dates it:

```console
$ nmr --log test
💾 nmr: test — recorded 2026-08-12T15:04:05.412Z (12m ago), ran in 12.4s
$ pnpm exec vitest --project unit --project tool

 ✓ src/__tests__/resolver.unit.test.ts (18 tests) 12ms

 Test Files  6 passed (6)
      Tests  41 passed (41)
```

The header presents the body as a recording rather than as this invocation's output. The command string is the whole chain, hooks included, so it names what earned the pass and not merely what was typed. A flag rather than a subcommand, since `log` would collide with the script registry.

**Reading a recording runs nothing.** nmr does not run any hook or print any verdict, and it does not record or restamp anything. `--no-cache` governs running rather than reading and is ignored.

**A recording is held to the tree, not to the terminal.** `--log` prints exactly what a skip would have recalled: The [pass key](#what-the-key-is-made-of) has to match. `--log` does not consult the [retention key](#replaying-a-skipped-runs-output), so a recording made under a different terminal width, or through a pipe, still prints -- the flag exists to show a reader at a terminal what a piped run wrote.

**A composite prints its assembly.** Retaining nothing of its own, a composite prints the excerpts that its constituents recorded, one attributed line each. To print the transcript of any one of them, run `--log` for that constituent.

**When nmr has nothing to show, it says so rather than printing a blank.** A refusal names which case applies -- the command is outside the [cacheable set](#what-is-cached), the [cache does not apply](#when-the-cache-does-not-apply), nothing has recorded a pass, the last pass was recorded under something this run does not share, or the pass did not retain any output, having printed none or written to a terminal -- and nmr exits non-zero, so that a caller can tell an empty `stdout` from a recording. A mismatch names the ingredient that changed, whether the tree, the chain, or a version, to keep a reader whose `git status` is clean from looking there.

```console
$ nmr --log test
🟠 nmr: test: no recording; the last pass was 3m ago, on a tree that this is not
```

**`--log` applies to the scopes that `-F` and `-R` select.** nmr passes the flag to the delegate. Each scope prints its own recording. There a scope with nothing to show reports its gap and exits 0: Partial coverage is normal for a survey, and failing on the first gap would hide every scope that had something to show. A selection that does not include any scope is the other case and fails, as it does for a run: An empty selection is not a partial survey.

**Retention has a ceiling of 256 KiB per recorded pass**, distinct from the 512 bytes to which a verdict line is held. nmr keeps 128 KiB from each end of a transcript that overruns it, because a run's opening and its closing statement each contain what the other does not, and it marks the drop with a line that names the dropped bytes, rather than cutting silently.

## Bypassing and clearing

Try these in order; the first is almost always the right one.

| Step                                   | Effect                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `nmr --no-cache <command>`             | Runs the command, then records the fresh result. Applies to the whole chain. |
| `NMR_NO_CACHE=1`                       | The same, for every nmr invocation in the shell.                             |
| `rm -rf node_modules/.cache/nmr-check` | Forgets every recorded pass, leaving build output alone.                     |
| `nmr clean`                            | Forgets every recorded pass and removes build output, at any scope.          |

`--no-cache` and `NMR_NO_CACHE=1` also bypass the Prettier cache that `nmr-fmt` keeps, because nmr exports `NMR_NO_CACHE=1` to the commands that it runs. nmr exports it too when a command is given trailing arguments, so `nmr fmt:check <pathspec>` runs uncached. See [`nmr-fmt`'s cache](utilities.md#cache).

`--no-cache` belongs before the command name. After it, it is an argument to the command rather than a flag to nmr; nmr reports this rather than silently ignoring the bypass.

## Reserved environment variables

`NMR_TREE_SNAPSHOT` is nmr's own: It passes one observation of the tree from a top-level invocation down to the processes that it spawns, so a chain hashes the tree once rather than at every link. nmr trusts an inherited value only while `HEAD` still points to the same commit as when the observation was taken, which bounds a process that outlives the run that spawned it. Because that bound does not extend to a tree edited without committing, **a process that survives its run and later invokes nmr should clear `NMR_TREE_SNAPSHOT`**. A test suite that shells out to `nmr` is the case worth checking.

`NMR_RUN_ID` is nmr's own too: It passes one run's identity from a top-level invocation down to the processes that it spawns, so that the excerpts recorded at every scope during one run are recognizable as that run's, and a composite can assemble from them. Whereas `NMR_TREE_SNAPSHOT` is bounded by `HEAD`, this one is bounded by the tree hash that each entry records. A process that outlives its run and carries the identity into a later one contributes nothing to that run's assemblies.

## Configuring

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

`extraCommands` extends the default set rather than replacing it, so naming one command cannot silently drop the rest. nmr applies `excludeCommands` afterwards and excludes a name that appears in both. `enabled: false` turns the gate off entirely. The key is `checkCache`, in the monorepo-root config.

**A name in either list must resolve to a command**, whether through nmr's defaults, the repo config's script records, or a package's own `package.json` scripts. Both lists are read by name alone, so a misspelt entry would otherwise be inert: The command that it meant to name would go on running, indistinguishable from one that cannot be cached at all. A name that resolves nowhere fails config load, naming the closest command if one exists. A hook name is rejected too, since a hook is never gated on its own -- it runs as part of the chain of the command that it wraps, and is skipped or run with it.

Because the test is resolvability rather than membership of the cacheable set, an `excludeCommands` entry stays valid after a release moves its name out of the defaults.
