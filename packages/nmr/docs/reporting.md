# What nmr reports

How nmr reports each command that it runs, in prose or as JSON, and how loudly it relays the output of those commands.

The verdict line and its four outcomes are shown in the [README](../README.md#what-nmr-reports).

A recalled pass also includes an excerpt of the run that it recalls, if that run left one; see [Replaying a skipped run's output](check-cache.md#replaying-a-skipped-runs-output).

The scope is the directory to which the command's registry belongs: a package's own directory, or the monorepo root. Durations and ages truncate and show at most two units, so a check that passed 119.9 seconds ago reports `1m 59s ago` and never `2m ago`.

Verdicts nest. A composite reports, and so does every command into which it expands; a `:pre` or `:post` hook reports nothing of its own, since the command that it wraps already reports for the chain, though a hook that delegates to a named command reports under that name. A `-R` or `-F` invocation reports nothing either; every scope to which it fans out reports instead. A cold repo-wide `nmr ci` in this package's own monorepo uses 26 verdict lines to report a run that prints roughly 250.

**A fan-out that does not select any scope fails.** A `-F` pattern matches a package's manifest `name` rather than its directory name, so a plausible directory name selects nothing, and pnpm exits 0 over an empty selection as it does over a passing one. nmr asks pnpm what the pattern selects and refuses the invocation when the answer is nothing, naming the pattern and, when the pattern contains a name, the names that it could have named. For a pattern of another form, the refusal states the rule to which that form answers: a directory (`./dir`, `/dir`, `{dir}`), an exclusion (`!`), or a changed-since selector (`[<ref>]`), none of which a workspace name repairs. A pattern that pnpm rejects rather than resolves, such as a bad git ref in a `[since]` selector, is left to pnpm to report. A `-R` typed on the invocation is refused on the same ground when the workspace does not declare any package at all, which is its only empty selection. That condition takes precedence over the pattern rules above: When the workspace does not contain any package, a `-F` pattern could not have matched one, so the refusal reports the workspace rather than the shape of the pattern.

**nmr reports a workspace that does not contain any package as one of four conditions.** `pnpm-workspace.yaml` may lack a positive pattern, declare patterns that do not match any directory containing a `package.json`, declare `!` exclusions that remove every directory matched by the positive patterns, or not contain valid YAML at all. Each refusal names its own condition and states a remedy, and each quotes the `packages` list that the manifest declares, apart from the last, whose manifest nmr could not read. The second is the likeliest, because nmr [counts a directory as a package](workspace.md) only if it contains `package.json` and recognizes neither `package.yaml` nor `package.json5`.

**A `-R` that nmr composed into a script is not a fan-out that the caller asked for.** In a workspace that does not contain any package, such a step -- in nmr's own default script or in a repo override alike -- is dropped from the chain, the steps beside it run, and the dropped step reports nothing of its own, as the rule above gives a `-R` invocation whose scopes report instead. When the drop leaves the command without any step at all, as it does the root `build`, the command reports a no-op naming the workspace. A repo that does not contain any workspace package therefore runs the default root commands without any entry in `.config/nmr.config.ts`.

A verdict is one write of at most 512 bytes, the smallest `PIPE_BUF` that POSIX permits, so packages running concurrently under `pnpm --recursive` cannot interleave within a line. A line longer than that is cut and marked with `…`; nothing nmr reports today comes near it.

## Reporting for a machine

`--json` renders each verdict as a JSON object instead of a line of prose: one object per line, newline-delimited, without an enclosing array or separators between them. A consumer parses each line as it arrives, and a run cut off partway still leaves every line that it already emitted parseable, which an enclosing array would not.

```console
$ nmr --json check
{"command":"typecheck","scope":"nmr-core","outcome":"passed","durationMs":255}
{"command":"fmt:check","scope":"nmr-core","outcome":"recalled","ageMs":240000,"savedMs":3888,"replay":[{"command":"fmt:check","excerpt":"Checking formatting... All matched files use Prettier code style!","scope":"nmr-core"}]}
{"command":"check","scope":"nmr-core","outcome":"passed","durationMs":31204}
```

Every object contains `command`, `scope`, and `outcome`, and then the fields that only that outcome includes:

| `outcome`  | Also contains                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `passed`   | `durationMs`                                                                                                             |
| `failed`   | `durationMs`, `exitCode`                                                                                                 |
| `recalled` | `ageMs`, `savedMs`, and `replay` where the skip has excerpts to [replay](check-cache.md#replaying-a-skipped-runs-output) |
| `no-op`    | `reason`, one of `empty-override`, `empty-workspace`, or `noop-override`                                                 |

Both renderings are produced from one record, so neither reports what the other does not. When the prose line makes a presentation decision that the record does not (a saving too small to be worth a clause, for example), the object contains the fact and leaves the decision to whoever reads it.

**An object is one write of at most 512 bytes**, the [same ceiling](#what-nmr-reports) to which a prose line is held. Packages running concurrently under `pnpm --recursive` cannot interleave within one. Because nmr cuts inside the record's text rather than across its structure, the line still parses. nmr fits a record that overruns by rungs, each dropping what a reader can spare more easily than what the rung below it drops:

1. **The excerpts are shortened toward one another**, so an assembly's constituents shrink together rather than the first ones being emptied to leave the last whole. nmr does not cut any excerpt below `…`, which keeps a cut one distinguishable from a run that recorded nothing.
2. **The excerpts go**, leaving the `scope` and `command` that name each constituent. An entry without an `excerpt` key is one whose text did not fit.
3. **The trailing constituents go**, as the prose line drops its own tail, and the `replay` array itself once none fit.
4. **The `scope` and `command` are cut**, each marked. This is the last resort and the reason for it is the ceiling itself: A line that overruns can be split across a pipe and corrupt the records of every scope sharing it, whereas a marked cut damages only its own.

A package-scoped `check` has four constituents and fits uncut. A four-package root `check` assembles twelve (`typecheck` and `test` each fan out to every package, and a nested composite's list is spliced in flat), which is more than the ceiling can name: It reaches rung 3, keeping eight and dropping the trailing four. Rung 4 needs a scope and command running to hundreds of bytes between them.

**The mode implies quiet.** The commands' own output is withheld, so stdout contains the objects alone, without a prose verdict or an override notice. `NMR_COMMAND_VERBOSITY=full` does not opt back out. On a failure, nmr still prints the failing command's output on stderr, as under any quiet run. Because both modes leave a command on the same channels, a machine-readable run and a quiet one share a [retention key](check-cache.md#replaying-a-skipped-runs-output): Each replays what the other recorded.

Because the format is nmr's own reporting, and nmr does not tell the commands that it runs about it, the format is out of the [pass key](check-cache.md#what-the-key-is-made-of) and the retention key alike. Selecting it neither invalidates a recorded pass nor prevents a replay.

`--log`, `--help`, and `--version` are unaffected: None of them reports a verdict, and what `--log` prints is a tool's own transcript, which cannot be rendered as a record.

## Reserved environment variables

`NMR_COMMAND_VERBOSITY` is nmr's own, and sets how loudly a run reports the output of the commands that it runs. Its values are `full` and `quiet`; nmr reports any other non-empty value and exits 1, rather than falling back to a mode that nobody chose, and an empty value reads as unset. Each process in a chain suppresses the output of the command that it runs rather than of everything below it, so the failing command's output still prints on a failure. It governs those commands' output alone: nmr's [verdicts](#what-nmr-reports) print in every verbosity, and the override notice is the one message that a quiet run withholds.

`-q` sets it for the run and outranks an inherited value. Both values are spelled out so that either direction is expressible: Export `NMR_COMMAND_VERBOSITY=quiet` for a quiet shell, and set `full` on one invocation to opt back out.

`NMR_OUTPUT_STYLE` is nmr's own as well, and sets the style in which nmr renders every marker that it prints; see [output style](#output-style) below.

`NMR_REPORT_FORMAT` is nmr's own as well, and sets how nmr renders its own verdicts. Its values are `text` and `json`; nmr reports any other non-empty value and exits 1, and an empty value reads as unset. `--json` sets it for the run and outranks an inherited value, and both values are spelled out so that either direction is expressible: Export `NMR_REPORT_FORMAT=json` for a shell whose consumer parses, and set `text` on one invocation to opt back out. The format has two sources, then, whereas a verbosity has four: It does not have a repo-level default or harness detection, because detection would hand every agent JSON in place of the prose that the [bundled guidance](../README.md#agent-guidance) teaches. See [reporting for a machine](#reporting-for-a-machine) for what the objects contain.

### Output style

`--output-style <auto|plain|rich>` sets the style for one invocation, and `NMR_OUTPUT_STYLE` sets it for a shell: `rich` marks each verdict with an emoji, such as ✅ or ❌, and `plain` prints a word in its place, such as `PASS` or `FAIL`, which a reader of a log can search for. `auto`, the default, defers to detection. Any other value is a usage error, and nmr exits with code 1, whichever source named it. The flag outranks the variable, and both accept `auto` as well as a style, so a shell exporting one style is overridable on one invocation in either direction.

Detection decides stdout and stderr separately. A stream is plain when `CI` is set to anything other than an empty string or `false`, when the stream is not a terminal, or when `TERM` is `linux`; otherwise it is rich. `--json` output does not contain a marker in either style.

**The flag belongs to `nmr`.** A standalone bin -- `nmr-clean`, `nmr-compile`, `nmr-report-catalog`, `nmr-report-overrides`, `nmr-ensure-prepublish-hooks` -- takes the variable alone, and passing it the flag produces that bin's unknown-option error. `nmr <command>` exports the style that it resolved, so a bin run through nmr renders as nmr does.

**A nested run follows the one that spawned it.** Because nmr passes the resolved style, never `auto`, down as `NMR_OUTPUT_STYLE`, a child whose own stdout is a pipe still renders rich when the parent resolved rich. The exported style is the one to which stdout resolved, and stdout receives the verdicts and nearly every other line; a parent at a terminal whose stderr alone is redirected therefore hands its children `rich`.

The style is out of the [pass key](check-cache.md#what-the-key-is-made-of) and the [retention key](check-cache.md#replaying-a-skipped-runs-output) alike, as the verbosity is: It changes how a run renders and never what a command concludes. Selecting it neither invalidates a recorded pass nor prevents a replay, and an excerpt recorded rich replays as recorded in a plain run.

### Where a verbosity comes from

Four sources, in precedence order. Each is read once, at the top of a chain: nmr passes the resolved value down as `NMR_COMMAND_VERBOSITY`, so a nested process reads a decision already made rather than making its own.

| Source                                                  | Set it when                                                |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `-q`                                                    | One invocation should be quiet.                            |
| `NMR_COMMAND_VERBOSITY`                                 | A shell, or a harness that launches one, should be quiet.  |
| `output.commandVerbosity` in the monorepo-root config   | A repo should be quiet for everyone working in it.         |
| An agent harness that nmr recognizes in the environment | Nothing above applies and an agent is running the command. |

Below the last source, a run is `full`, which is what an unrecognized harness gets: Detection adds quiet when it fires and changes nothing when it does not.

Detection reads a set of environment-variable names and fires on any one of them holding a non-empty value. The bundled set is `CLAUDECODE`, `ROVODEV_CLI`, and `ROVO_CLI`. **Expect that set to change.** The names belong to ecosystems that nmr does not control and that rename them, and a rename fails silently here, since the symptom is a return to loud output rather than an error. A repo adds a name with `output.extraAgentEnvVars` (for a harness unknown to nmr, or one whose marker was renamed after the installed version was released) without waiting for a release. A repo that does not want any detection at all configures `output.commandVerbosity: 'full'`, which outranks it.

## Configuring

```ts
export default defineConfig({
  output: {
    // The verbosity that a run takes when neither `-q` nor the environment named one.
    commandVerbosity: 'quiet',
    // Markers of a harness that the bundled set does not name, added to it rather than replacing it.
    extraAgentEnvVars: ['MY_HARNESS'],
  },
});
```

`output` is a monorepo-root key, and both of its fields are inputs to the [verbosity ladder](#where-a-verbosity-comes-from).
