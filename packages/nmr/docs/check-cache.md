# Check-result cache

How nmr skips a check that already passed on the same working tree, what decides a hit, and how to read, bypass, and configure what it recorded.

The [README](../README.md#check-result-cache) shows a skip in action.

Composite commands expand into child `nmr` processes, so one green `nmr ci` records a pass for every cacheable command in the chain, at every scope it ran at. A later `nmr check`, `nmr typecheck`, or `nmr -F core test` on the same tree skips too. The skip is [reported](reporting.md#what-nmr-reports) in every verbosity.

The cache is a working-tree cache, not a build cache: it answers "has this exact tree already passed this check?" and nothing else. It is also local to one checkout (the install fingerprint in its key is machine-specific), so it saves repeated work in a working copy rather than sharing results across machines or with CI.

## What is cached

Cacheable by default: `check`, `check:strict`, `ci`, `fix:check`, `fmt:check`, `lint:check`, `lint:strict`, `test`, `test:coverage`, `test:tool`, `test:unit`, `typecheck`, and the `root:` variants `root:check`, `root:lint:check`, `root:lint:strict`, `root:test`, `root:test:tool`, `root:test:unit`, and `root:typecheck`.

Everything else runs every time:

| Command                         | Why it is never skipped                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `audit`, `prepush`              | Consult a vulnerability database that moves without the tree. `prepush`'s `ci` constituent still skips while its `audit` runs every time. |
| `build`, `compile`              | Carry a cache of their own.                                                                                                               |
| `fix`, `fmt`, `lint`, `upgrade` | Rewrite the tree they were asked about, so a recorded pass would describe a tree that no longer exists.                                   |
| `test:all`                      | Reaches the `localhost` and `remote` tiers, which the environment supplies rather than the tree.                                          |

## The exit-status-only contract

**A cacheable name promises that its whole contribution is an exit status**, through its entire chain, `:pre` and `:post` hooks included. A hit skips that chain wholesale, so any file a cacheable command was relied on to produce is a file that will not appear.

`test:coverage` is cacheable on exactly this reading: what it contributes is the pass, not the `coverage/` directory, which a skipped run leaves as whatever the last real run wrote. Read `coverage/` after a `test:coverage` that may have skipped, and it may be stale; `--no-cache` is how you insist on a fresh one.

Overriding a cacheable name, in `package.json` or in `workspaceScripts`, inherits its cacheability. An override that writes something anyone depends on belongs in `excludeCommands`.

## What the key is made of

A hit requires all of these to match the run that recorded the pass:

- **The working tree's content**, hashed from the commit's tree object folded with the current content of every path git reports as changed or untracked. Timestamps are not content, so a `touch` that rewrites no bytes leaves the hash alone.
- **The command string that would run**, hooks and all, and the scope it would run in.
- **nmr's version**, the **Node version**, and the **platform and architecture**.
- **What pnpm has installed**, so an install, a prune, or a lockfile change forces a re-run.
- **`TZ`, `LANG`, `LC_ALL`, and `NODE_OPTIONS`.** This set is fixed, so two machines that differ only in shell decoration still agree.

A hit additionally requires the build output of every package nmr's own build covers to be present, and to have been built from this tree. Output is git-ignored, so neither its removal nor its replacement moves the hash: restoring a tree with `git stash` or `git checkout` restores none of the output that tree was built with. nmr compares each covered package's recorded build digest against the one on disk, so a `dist` compiled from another tree is a miss the following run repairs. A package that overrides `build` or `compile` emits on terms nmr does not know and is exempt.

A pass is recorded only when the command exits 0, only when the tree still matches the one the run started against, only when every covered package's output is present and unchanged since the run started, and never for a run that executed nothing (a `""`/`":"` skip override, or an `NMR_RUN_IF_PRESENT` miss). Output that moves mid-run leaves no answer to which output the pass was earned over, whether another process rebuilt it or the chain built it itself: `nmr ci` is the one default command whose chain does, and it records nothing on a run whose build did work. The `nmr check:strict` inside that chain still records, because its own window opens after the build.

## Out of contract

These change what a check concludes without moving the hash. Where one applies, exclude the affected command:

- **Content filters.** `core.autocrlf` and `.gitattributes` filters mean the bytes on disk differ from the bytes git records; the hash follows what is on disk, but a checkout on another platform may not reproduce it.
- **Symlinked inputs.** A symlink is hashed by the path it names, not by the content at the far end.
- **Gitignored inputs.** Anything git does not report is invisible to the hash. The build-output probe is the one exception, and covers only nmr's own build.
- **`passWithNoTests`.** A suite that collects no files exits 0, and that green is recorded like any other.

Committing an already-checked tree also moves the hash, because the commit's tree object is the base of the fold; the next run does the work again. The reverse holds and is useful: a rebase or an amended message that preserves content leaves the hash alone, as does checking out a branch whose tree is identical.

## When the gate stands aside

The gate never wrongly skips. Where it cannot be sure, it does nothing and the command runs:

- Outside a git repository, when git fails, or when there is no commit at `HEAD`.
- When the repository declares or contains submodules, whose content the hash does not cover.
- When the monorepo root is not the git toplevel.
- When a changed path cannot be read, or is neither a file nor a symlink (an untracked nested repository, for instance).
- When there is no pnpm install to fingerprint.
- Under a `devBin` substitution, which runs a binary built from somewhere the hash does not describe.
- For any invocation carrying arguments after the command name, and for every step below it: the arguments narrow what runs, and a step served from a recorded pass is a step that did not.

`NMR_DEBUG=1` reports why a run did not skip and why the gate stood aside.

## Replaying a skipped run's output

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

The whole line, excerpt included, is held to the same [512-byte ceiling](reporting.md#what-nmr-reports) every verdict is, so one write still carries it whole under concurrent fan-out. An assembly wide enough to overrun it is cut and marked with `…` rather than spread over several lines.

## Reading a retained run

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

**`--log` reaches the scopes `-F` and `-R` select.** The flag rides the delegate, so each scope prints its own recording. There a scope with nothing to show reports its gap and exits 0: partial coverage is a survey's normal shape, and failing on the first gap would hide every scope that had something. A selection of no scope at all is the other case and fails, as it does for a run: there is no survey to be partial.

**Retention has a ceiling of 256 KiB per recorded pass**, distinct from the 512 bytes a verdict line is held to. A transcript overrunning it keeps 128 KiB from each end, because a run's opening and its closing statement each carry what the other does not, and the drop is marked with a line naming the bytes it stands for rather than being cut silently.

## Bypassing and clearing

Reach for these in order; the first is almost always the right one.

| Step                                   | Effect                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `nmr --no-cache <command>`             | Runs the command, then records the fresh result. Reaches the whole chain. |
| `NMR_NO_CACHE=1`                       | The same, for every nmr invocation in the shell.                          |
| `rm -rf node_modules/.cache/nmr-check` | Forgets every recorded pass, leaving build output alone.                  |
| `nmr clean`                            | Forgets every recorded pass and removes build output, at any scope.       |

`--no-cache` belongs before the command name. After it, it is an argument to the command rather than a flag to nmr; nmr says so rather than letting the bypass silently not happen.

## Reserved environment variables

`NMR_TREE_SNAPSHOT` is nmr's own: it carries one observation of the tree from a top-level invocation down to the processes it spawns, so a chain hashes the tree once rather than at every link. nmr trusts an inherited value only while `HEAD` still stands where it did when the observation was taken, which bounds a process that outlives the run that spawned it. That bound does not extend to a tree edited without committing, so **a process that survives its run and later invokes nmr should clear `NMR_TREE_SNAPSHOT`** — a test suite that shells out to `nmr` is the case worth checking.

`NMR_RUN_ID` is nmr's own too: it carries one run's identity from a top-level invocation down to the processes it spawns, so the excerpts recorded at every scope during one run are recognizable as that run's, and a composite can assemble from them. Where `NMR_TREE_SNAPSHOT` is bounded by `HEAD`, this is bounded by the tree hash each entry records, so a process that outlives its run and carries the identity into a later one contributes nothing to that run's assemblies.

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

`extraCommands` extends the default set rather than replacing it, so naming one command cannot silently drop the rest; `excludeCommands` is applied afterwards, so a name in both is excluded. `enabled: false` turns the gate off entirely. The key is `checkCache`, in the monorepo-root config.

**A name in either list must resolve to a command**, whether through nmr's defaults, the repo config's script records, or a package's own `package.json` scripts. Both lists are read by name alone, so a misspelt entry would otherwise be inert: the command it meant to name would go on running, indistinguishable from one that cannot be cached at all. A name that resolves nowhere fails config load, naming the closest command where there is one. A hook name is rejected too, since a hook is never gated on its own -- it runs as part of the chain of the command it wraps, and is skipped or run with it.

The test is resolvability rather than membership of the cacheable set, so an `excludeCommands` entry keeps standing after a release moves its name out of the defaults.
