---
slug: nmr
description: Invocation rules for the nmr script runner in a pnpm monorepo.
delivery: ambient
---

# nmr: agent guidance

- Use `nmr <command>`, not `pnpm run <command>`, for anything nmr provides. Run bare `nmr` to list every command and the shell command it resolves to; a wrong guess reports only `Unknown command`, with no list.
- Scope follows cwd, and bare `nmr` lists both registries: from the repo root a command covers root files and every workspace; from inside a package, that package alone. `nmr -F <pkg> <command>` targets one package from anywhere; `nmr root:<command>` targets root files alone, which isolates a failure to root code.
- Never `npx nmr`: inside a git worktree it can resolve a different nmr from outside the tree. Fall back to `pnpm exec nmr`.
- `nmr ci` runs what a code-quality workflow runs (build, then strict checks) and not the dependency audit, which belongs to a workflow of its own; `nmr prepush` runs the audit first, then `ci`, so a vulnerability stops the run before the long gate. Neither installs or binds a git hook.
- A check that already passed on the current working tree skips, printing `⏭️ <scope>: <command>: passed …`. Any edit, addition, or deletion re-runs it, so a skip is a real pass and needs no confirming: never pass `--no-cache` to get a "real" run, which costs the command's full runtime to reach the same answer. Its one use is a file rather than an exit status -- a skipped command writes none, so a fresh `coverage/` needs `nmr --no-cache test:coverage`.
- Every command nmr runs reports one line -- `✅ <scope>: <command>: passed in 12.4s`, `❌ … failed in 1.2s (exit 1)`, `⏭️ … passed 4m ago on this tree`, or `⛔ … skipped, the override is empty` -- and a composite reports alongside every command it expands into. The lines print in every verbosity, so `-q` is the low-noise way to run rather than a silent one: it withholds the output of the commands nmr runs and keeps nmr's own verdicts, which is how a pass, a cached skip, and a `""`/`":"` override stay distinguishable. Expect a run to be quiet already without the flag: nmr recognizes a known agent harness in the environment and takes quiet from that, as it does from `NMR_COMMAND_VERBOSITY` or the repo's `output.commandVerbosity`. A command whose output you need in full is one to run with `NMR_COMMAND_VERBOSITY=full`, which outranks both.
- The rest is in `node_modules/@williamthorsen/nmr/README.md`: pre/post hooks (every `nmr X` auto-wraps as `nmr X:pre && nmr X && nmr X:post`), script overrides and their `""`/`":"` skip values, `nmr upgrade` ceilings (report-only until `nmr upgrade --write`), the `nmr-compile` build (there is no repo-local build script), and the check-result cache's key, its `checkCache` config, and every condition that disables it.
