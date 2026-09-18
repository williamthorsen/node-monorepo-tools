# What nmr reports

How nmr reports each command it runs, in prose or as JSON, and how loudly it relays the output of those commands.

The verdict line and its four outcomes are shown in the [README](../README.md#what-nmr-reports).

A recalled pass also carries an excerpt of the run it recalls, where that run left one; see [Replaying a skipped run's output](check-cache.md#replaying-a-skipped-runs-output).

The scope is the directory the command's registry belongs to: a package's own directory, or the monorepo root. Durations and ages truncate and carry at most two units, so a check that passed 90 seconds ago reports `1m 30s ago` and never `2m ago`.

Verdicts nest. A composite reports, and so does every command it expands into; a `:pre` or `:post` hook reports nothing of its own, since the command it wraps already reports for the chain, though a hook that delegates to a named command reports under that name. A `-R` or `-F` invocation reports nothing either, every scope it fans out to reporting instead. A cold repo-wide `nmr ci` in this package's own monorepo spends 26 lines on a run that prints roughly 250.

**A fan-out that selects no scope fails.** A `-F` pattern matches a package's manifest `name` rather than its directory name, so a plausible directory name selects nothing, and pnpm exits 0 over an empty selection as it does over a passing one. nmr asks pnpm what the pattern selects and refuses the invocation where the answer is nothing, naming the pattern and, where the pattern carries a name, the names it could have named. A pattern of another form states the rule its own shape answers to: a directory (`./dir`, `/dir`, `{dir}`), an exclusion (`!`), or a changed-since selector (`[<ref>]`), none of which a workspace name repairs. A pattern pnpm rejects rather than resolves, such as a bad git ref in a `[since]` selector, is left to pnpm to report. A `-R` typed on the invocation is refused on the same ground where the workspace declares no package at all, which is its only empty selection. That condition answers ahead of the pattern rules above: where the workspace holds no package, no `-F` pattern would have matched, so the refusal reports the workspace rather than the shape of the pattern.

**A workspace that holds no package is reported as one of three conditions.** `pnpm-workspace.yaml` may declare no positive pattern, declare patterns that match no directory holding a `package.json`, or declare `!` exclusions that remove every directory matched by the positive patterns. Each refusal names its own condition, quotes the `packages` list the manifest declares, and states a remedy. The second is the likeliest, because nmr [counts a directory as a package](workspace.md) only where it holds `package.json` and recognizes neither `package.yaml` nor `package.json5`.

**A `-R` that nmr composed into a script is not a fan-out the caller asked for.** In a workspace that holds no package, such a step -- in nmr's own default script or in a repo override alike -- is dropped from the chain, the steps beside it run, and the dropped step reports nothing of its own, as the rule above gives a `-R` invocation whose scopes report instead. Where the drop leaves the command with no step at all, as it does the root `build`, the command reports a no-op naming the workspace. A repo that holds no workspace package therefore runs the default root commands with no entry in `.config/nmr.config.ts`.

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
| `no-op`    | `reason`, one of `empty-override`, `empty-workspace`, or `noop-override`                                                 |

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

`NMR_OUTPUT_STYLE` is nmr's own as well, and carries the style every marker nmr prints is rendered in; see [output style](#output-style) below.

`NMR_REPORT_FORMAT` is nmr's own as well, and carries how nmr renders its own verdicts. Its values are `text` and `json`; any other non-empty value is reported and exits 1, and an empty value reads as unset. `--json` sets it for the run and outranks an inherited value, and both values are spelled out so either direction is expressible: export `NMR_REPORT_FORMAT=json` for a shell whose consumer parses, and set `text` on one invocation to opt back out. Two sources, then, where a verbosity has four: no repo-level default and no harness detection, since detection would hand every agent JSON in place of the prose the [shipped guidance](../README.md#agent-guidance) teaches. See [reporting for a machine](#reporting-for-a-machine) for what the objects carry.

### Output style

`--output-style <auto|plain|rich>` sets the style for one invocation, and `NMR_OUTPUT_STYLE` sets it for a shell: `rich` marks each verdict with an emoji, such as ✅ or ❌, and `plain` prints a word in its place, such as `PASS` or `FAIL`, which a reader of a log can search for. `auto`, the default, defers to detection. Any other value is a usage error that exits with code 1, whichever source named it. The flag outranks the variable, and both name `auto` as well as a style, so a shell exporting one style is overridable on one invocation in either direction.

Detection decides stdout and stderr separately. A stream is plain when `CI` is set to anything other than an empty string or `false`, when the stream is not a terminal, or when `TERM` is `linux`; otherwise it is rich. `--json` output carries no marker in either style.

**The flag belongs to `nmr`.** A standalone bin -- `nmr-clean`, `nmr-compile`, `nmr-report-catalog`, `nmr-report-overrides`, `nmr-ensure-prepublish-hooks` -- takes the variable alone, and passing it the flag gets that bin's unknown-option error. `nmr <command>` exports the style it resolved, so a bin run through nmr renders as nmr does.

**A nested run follows the one that spawned it.** The resolved style, never `auto`, travels down as `NMR_OUTPUT_STYLE`, so a child whose own stdout is a pipe still renders rich where the parent resolved rich. The style exported is the one stdout resolved to, which is where the verdicts and nearly every other line go; a parent at a terminal whose stderr alone is redirected therefore hands its children `rich`.

The style is out of the [pass key](check-cache.md#what-the-key-is-made-of) and the [retention key](check-cache.md#replaying-a-skipped-runs-output) alike, as the verbosity is: it changes how a run renders and never what a command concludes. Selecting it neither invalidates a recorded pass nor costs a replay, and an excerpt recorded rich replays as recorded in a plain run.

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
