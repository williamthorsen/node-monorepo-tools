# What nmr reports

How nmr reports each command it runs, in prose or as JSON, and how loudly it relays the output of those commands.

The verdict line and its four outcomes are shown in the [README](../README.md#what-nmr-reports).

A recalled pass also carries an excerpt of the run it recalls, where that run left one; see [Replaying a skipped run's output](check-cache.md#replaying-a-skipped-runs-output).

The scope is the directory the command's registry belongs to: a package's own directory, or the monorepo root. Durations and ages truncate and carry at most two units, so a check that passed 90 seconds ago reports `1m 30s ago` and never `2m ago`.

Verdicts nest. A composite reports, and so does every command it expands into; a `:pre` or `:post` hook reports nothing of its own, since the command it wraps already reports for the chain, though a hook that delegates to a named command reports under that name. A `-R` or `-F` invocation reports nothing either, every scope it fans out to reporting instead. A cold repo-wide `nmr ci` in this package's own monorepo spends 26 lines on a run that prints roughly 250.

**A fan-out that selects no scope fails.** A `-F` pattern matches a package's manifest `name` rather than its directory name, so a plausible directory name selects nothing, and pnpm exits 0 over an empty selection as it does over a passing one. nmr asks pnpm what the pattern selects and refuses the invocation where the answer is nothing, naming the pattern and, where the pattern carries a name, the names it could have named. A pattern of another form states the rule its own shape answers to: a directory (`./dir`, `/dir`, `{dir}`), an exclusion (`!`), or a changed-since selector (`[<ref>]`), none of which a workspace name repairs. A pattern pnpm rejects rather than resolves, such as a bad git ref in a `[since]` selector, is left to pnpm to report. `-R` is refused on the same ground where the workspace declares no package at all, which is its only empty selection.

A verdict is one write of at most 512 bytes, the smallest `PIPE_BUF` POSIX permits, so packages running concurrently under `pnpm --recursive` cannot interleave within a line. A line longer than that is cut and marked with `…`; nothing nmr reports today comes near it.

## Reporting for a machine

`--json` renders each verdict as a JSON object instead of a line of prose — one object per line, newline-delimited, with no enclosing array and no separators between them. A consumer parses each line as it arrives, and a run cut off partway still leaves every line it already emitted parseable, which an enclosing array would not.

```console
$ nmr --json check
{"command":"typecheck","scope":"nmr-core","outcome":"passed","durationMs":255}
{"command":"fmt:check","scope":"nmr-core","outcome":"recalled","ageMs":240000,"savedMs":3888,"replay":[{"command":"fmt:check","excerpt":"Checking formatting... All matched files use Prettier code style!","scope":"nmr-core"}]}
{"command":"check","scope":"nmr-core","outcome":"passed","durationMs":31204}
```

Every object carries `command`, `scope`, and `outcome`, and then what that outcome carries and no other does:

| `outcome`  | Also carries                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `passed`   | `durationMs`                                                                                                             |
| `failed`   | `durationMs`, `exitCode`                                                                                                 |
| `recalled` | `ageMs`, `savedMs`, and `replay` where the skip has excerpts to [replay](check-cache.md#replaying-a-skipped-runs-output) |
| `no-op`    | `reason`, either `empty-override` or `noop-override`                                                                     |

Both renderings are produced from one record, so neither reports what the other does not. Where the prose line makes a presentation decision the record does not — a saving too small to be worth a clause, say — the object carries the fact and leaves the decision to whoever reads it.

**An object is one write of at most 512 bytes**, the [same ceiling](#what-nmr-reports) a prose line is held to, so packages running concurrently under `pnpm --recursive` cannot interleave within one. Cuts land inside the record's text rather than across its structure, so the line still parses, and a record that overruns is fitted by rungs — each shedding what a reader can better spare than the one below it:

1. **The excerpts are shortened toward one another**, so an assembly's constituents come down together rather than the first ones being emptied to leave the last whole. No excerpt is cut below `…`, which keeps a cut one distinguishable from a run that recorded nothing.
2. **The excerpts go**, leaving the `scope` and `command` that name each constituent. An entry carrying no `excerpt` key is one whose text did not fit.
3. **The trailing constituents go**, as the prose line drops its own tail, and the `replay` array itself once none fit.
4. **The `scope` and `command` are cut**, each marked. This is the last resort and the reason for it is the ceiling itself: a line that overruns can be split across a pipe and corrupt the records of every scope sharing it, where a marked cut costs only its own.

A package-scoped `check` carries four constituents and fits uncut. A four-package root `check` assembles twelve — `typecheck` and `test` each fan out to every package, and a nested composite's list is spliced in flat — which is more than the ceiling can name: it reaches rung 3, keeping eight and dropping the trailing four. Rung 4 needs a scope and command running to hundreds of bytes between them.

**The mode implies quiet.** The commands' own output is withheld, so stdout carries the objects alone — no prose verdict, and no override notice. `NMR_COMMAND_VERBOSITY=full` does not opt back out. A failure still surrenders the failing command's output, on stderr, as under any quiet run. Both modes leave a command on the same channels, so a machine-readable run and a quiet one share a [retention key](check-cache.md#replaying-a-skipped-runs-output): each replays what the other recorded.

The format is nmr's own reporting and not a mode the commands it runs are told about, so it is out of the [pass key](check-cache.md#what-the-key-is-made-of) and the retention key alike. Selecting it neither invalidates a recorded pass nor costs a replay.

`--log`, `--help`, and `--version` are unaffected: none of them reports a verdict, and what `--log` prints is a tool's own transcript, which has no rendering as a record.

## Reserved environment variables

`NMR_COMMAND_VERBOSITY` is nmr's own, and carries how loudly a run reports the output of the commands it runs. Its values are `full` and `quiet`; any other non-empty value is reported and exits 1, rather than falling back to a mode nobody chose, and an empty value reads as unset. Each process in a chain suppresses the output of the command it runs rather than of everything below it, so a failure still surrenders the failing command's output. It governs those commands' output alone: nmr's [verdicts](#what-nmr-reports) print in every verbosity, and the override notice is the one message a quiet run withholds.

`-q` sets it for the run and outranks an inherited value. Both values are spelled out so either direction is expressible: export `NMR_COMMAND_VERBOSITY=quiet` for a quiet shell, and set `full` on one invocation to opt back out.

`NMR_REPORT_FORMAT` is nmr's own as well, and carries how nmr renders its own verdicts. Its values are `text` and `json`; any other non-empty value is reported and exits 1, and an empty value reads as unset. `--json` sets it for the run and outranks an inherited value, and both values are spelled out so either direction is expressible: export `NMR_REPORT_FORMAT=json` for a shell whose consumer parses, and set `text` on one invocation to opt back out. Two sources, then, where a verbosity has four: no repo-level default and no harness detection, since detection would hand every agent JSON in place of the prose the [shipped guidance](../README.md#agent-guidance) teaches. See [reporting for a machine](#reporting-for-a-machine) for what the objects carry.

### Where a verbosity comes from

Four sources, in precedence order. Each is read once, at the top of a chain: the resolved value travels down as `NMR_COMMAND_VERBOSITY`, so a nested process reads a decision already made rather than making its own.

| Source                                                | Set it when                                                |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `-q`                                                  | One invocation should be quiet.                            |
| `NMR_COMMAND_VERBOSITY`                               | A shell, or a harness that launches one, should be quiet.  |
| `output.commandVerbosity` in the monorepo-root config | A repo should be quiet for everyone working in it.         |
| An agent harness nmr recognizes in the environment    | Nothing above applies and an agent is running the command. |

Falling off the bottom leaves the run `full`, which is what an unrecognized harness gets: detection adds quiet where it fires and changes nothing where it does not.

Detection reads a set of environment-variable names and fires on any one of them holding a non-empty value. The shipped set is `CLAUDECODE`, `ROVODEV_CLI`, and `ROVO_CLI`. **Treat that set as perishable.** The names belong to ecosystems nmr does not control and that rename, and a rename fails silently here, since the symptom is a return to loud output rather than an error. `output.extraAgentEnvVars` is how a repo adds a name — a harness nmr has never heard of, or one whose marker was renamed after the installed version shipped — without waiting for a release. A repo that wants no detection at all configures `output.commandVerbosity: 'full'`, which outranks it.

## Configuring

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
