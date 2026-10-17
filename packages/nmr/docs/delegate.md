# Delegating to another machine

nmr runs a command on another machine over SSH, against the working tree on this one, and reports the command's output and exit status here:

```console
$ nmr --delegate imac2 ci
# ... the host's own output and verdicts ...
✅ my-repo: ci: passed on imac2 in 1m 48s
```

A machine that runs several worktrees' checks at once runs out of memory, and the [machine lock](machine-lock.md) protects it by making the checks wait for one another. Delegation moves a check to a machine that has the room for it instead.

## Choosing where a command runs

| Step                          | Effect                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| `nmr --delegate <host> <cmd>` | Runs the command on `<host>`. `--delegate=<host>` is the same.          |
| `NMR_DELEGATE=<host>`         | Runs every command that can be delegated on `<host>`.                   |
| `nmr --no-delegate <cmd>`     | Runs the command here, whatever `NMR_DELEGATE` names. It outranks both. |

`<host>` is anything that `ssh` accepts: a name from `~/.ssh/config`, `user@host`, or an address. Like every nmr flag, these belong before the command name; nmr warns about one written after it, because the command then runs here.

`NMR_DELEGATE` is how an agent session's checks reach the host without any change to the commands that the agent runs: Set it in the session's environment.

## What can be delegated

Every command whose contribution is its exit status: `ci`, `prepush`, `check`, the `test` commands, `typecheck`, and a custom script such as `test:e2e`. nmr decides on the name that the invocation gives, so `ci` runs on the host as one unit, `build` step included.

These run here, and `--delegate` refuses them: `build`, `clean`, `compile`, `fix`, `fmt`, `lint`, `test:watch`, and `upgrade`, with their `root:` forms, which rewrite the working tree or run until stopped; and `--log`, which reads this machine's recordings. Under `NMR_DELEGATE`, they run here without comment.

## What the host runs

nmr records the working tree as it is on disk as a commit: tracked changes, staged or not, and untracked files that git does not ignore. This is the tree that a local run checks. The commit is built in a temporary index, so the repository's index, refs, and stash do not change.

nmr pushes the commit to a checkout on the host under `~/.cache/nmr/delegate/`, without running the repository's `pre-push` hook, then runs `pnpm install --frozen-lockfile` and the command from the directory that corresponds to the local one, with nmr's own flags as they were given. The host keeps one checkout for each repository on each machine that delegates to it, so concurrent delegations from different worktrees do not share one, and `node_modules` and build output persist between runs. nmr does not remove these checkouts.

- **Ignored files stay here.** A command that needs a gitignored file, such as a local `.env`, does not find it on the host.
- **A repository with submodules cannot be delegated**, nor can a tree containing a nested repository, because the snapshot does not include their content. `--delegate` refuses such a tree; under `NMR_DELEGATE`, the command runs here, and nmr prints one line saying why.
- **One worktree delegates one command at a time.** Two delegations from the same worktree at once share a checkout on the host.

On the host, the command runs under the host's own [machine lock](machine-lock.md) and [check-result cache](check-cache.md), so a host that serves several worktrees runs their heavy commands one at a time, and a tree that already passed there skips. A delegated run does not take the lock here, and it neither consults nor records this machine's cache, whose key is specific to the machine.

Ctrl-C ends the run on the host as well as here.

## Reporting

The host's nmr prints its output and verdicts, and nmr here adds one verdict for the whole delegation, its transfer and install included, which names the host. `--json` adds a `host` field to that object; see [reporting for a machine](reporting.md#reporting-for-a-machine).

A failure of the delegation itself, rather than of the command, exits 255, the status with which `ssh` reports its own failures, and names the step that failed, after what that step printed:

```console
❌ my-repo: ci: failed on imac2 in 10.0s (exit 255) — could not prepare imac2
```

The steps are `prepare`, which reaches the host and creates the checkout, `push`, `check out`, and `install`. A connection lost while the command runs is reported as `lost connection to <host>`.

## Setting up the host

- **SSH that does not prompt.** nmr runs `ssh` with `BatchMode=yes`, so a key that needs a passphrase must be in the agent, and the host key must already be known. An unreachable host fails within 10 seconds.
- **git, Node, and pnpm on the interactive login shell's `PATH`.** nmr reads `PATH` from the host's login shell started as an interactive one, which loads `~/.zshrc` or `~/.bashrc` as well as the login profile: That is where pnpm's installer and the common version managers put Node and pnpm. What the startup files print does not reach the output, but whatever else they do runs before each step. When pnpm is not on that `PATH`, the install step fails, naming `PATH`. The login shell must accept `-ilc`: bash and zsh do.
- **A sandboxed agent session needs network access to the host.** A sandbox that allows only HTTP egress refuses `ssh`, and the delegation fails at `prepare`.
