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
- A check that already passed on the current working tree skips, printing `⏭️ <command>: passed …`. Any edit, addition, or deletion re-runs it, so a skip is a real pass and needs no confirming: never pass `--no-cache` to get a "real" run, which costs the command's full runtime to reach the same answer. Its one use is a file rather than an exit status -- a skipped command writes none, so a fresh `coverage/` needs `nmr --no-cache test:coverage`.
- The rest is in `node_modules/@williamthorsen/nmr/README.md`: pre/post hooks (every `nmr X` auto-wraps as `nmr X:pre && nmr X && nmr X:post`), script overrides and their `""`/`":"` skip values, `nmr upgrade` ceilings (report-only until `nmr upgrade --write`), the `nmr-compile` build (there is no repo-local build script), and the check-result cache's key, its `checkCache` config, and every condition that disables it.
