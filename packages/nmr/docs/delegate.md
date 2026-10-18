# Delegating to another machine

nmr runs a command on another machine over SSH, against the working tree on this one, and reports the command's output and exit status here:

```console
$ nmr --delegate-to imac2 ci
# ... the host's own output and verdicts ...
✅ my-repo: ci: passed on imac2 in 1m 48s
```

A machine that runs several worktrees' checks at once runs out of memory, and the [machine lock](machine-lock.md) protects it by making the checks wait for one another. Delegation moves a check to a machine that has the room for it instead. Which hosts a machine can reach is a fact about the machine, so a user config on the machine, not the repo, names them and turns delegation on.

## The user config

`~/.config/nmr/config.ts`, or `$XDG_CONFIG_HOME/nmr/config.ts` when `XDG_CONFIG_HOME` is set, declares this machine's hosts and when to delegate to them without being asked. It honors one key, `delegate`:

```ts
export default {
  delegate: { hosts: ['imac2', 'imac3'], when: 'agent' },
};
```

- **`hosts`** lists the hosts in order of preference. It is required whenever `delegate` is present.
- **`when`** turns on delegation by default: `'agent'` for every run whose environment contains an agent-harness marker, the variables that also select [quiet output](reporting.md#configuring), extended by the repo's `output.extraAgentEnvVars`; `'always'` for every run. Without `when`, nmr delegates only on request, and `hosts` serves `--delegate`.

nmr reads the file only when a decision reaches it, and an unrecognized key, a malformed `hosts`, or an unknown `when` fails that run with an error naming the file and the key. The file cannot import anything from a repo, so it is a plain object rather than a `defineConfig` call.

A pass that a host earns satisfies a later delegation to that host, but not a run here: Under `when`, a run that `--no-delegate` keeps here re-runs a check that the host already passed. See [consulting the cache first](#consulting-the-cache-first).

## Choosing where a command runs

| Form                                 | Effect                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `nmr --delegate <cmd>`               | Runs the command on `NMR_DELEGATE`'s hosts if it names any, otherwise the user config's; refused when neither does |
| `nmr --delegate-to <hosts> <cmd>`    | Runs the command on `<hosts>`. `--delegate-to=<hosts>` is the same.                                                |
| `nmr --no-delegate <cmd>`            | Runs the command here                                                                                              |
| `NMR_DELEGATE=<hosts>`               | Runs every command that can be delegated on `<hosts>`                                                              |
| `delegate: false` in the repo config | Keeps every command here unless a flag asks otherwise                                                              |

`<hosts>` is one host or a comma-separated list in order of preference, such as `imac2,imac3`; see [choosing among several hosts](#choosing-among-several-hosts). A host is anything that `ssh` accepts: a name from `~/.ssh/config`, `user@host`, or an address. Like every nmr flag, these belong before the command name; nmr warns about one written after it, because the command then runs here. `--delegate=<hosts>` is refused with a message naming `--delegate-to`, and so is a host name written after `--delegate`, which nmr reads as the command.

The first rule that applies decides where a command runs:

| #   | Condition                                                                               | Runs                                                                                                               |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `--no-delegate`                                                                         | Here                                                                                                               |
| 2   | `--delegate` or `--delegate-to`                                                         | On a host; a command that cannot be delegated, or a tree that cannot be snapshotted, is refused                    |
| 3   | The repo config declares `delegate: false`                                              | Here                                                                                                               |
| 4   | `NMR_DELEGATE` names hosts                                                              | On a host; a command that cannot be delegated runs here, and a tree that cannot be snapshotted, here with one line |
| 5   | `NMR_DELEGATE` is set but does not name a host                                          | Here                                                                                                               |
| 6   | The user config's `when` matches, `CI` is unset, and the invocation is not `-F` or `-R` | On a host, as for rule 4                                                                                           |
| 7   | Otherwise                                                                               | Here                                                                                                               |

- **A step and a `-F` or `-R` child run where their parent runs.** nmr gives every process that it starts an empty `NMR_DELEGATE`, which rule 5 reads as "here"; the run on a host already passes `--no-delegate`, so a host does not apply its own user config. A git hook that an agent's command starts is an agent run.
- **A repo whose checks must run on the machine that has the tree** declares `delegate: false` in `.config/nmr.config.ts`, the only value that the repo config accepts for the key. It outranks `NMR_DELEGATE` and the user config, but not a flag.
- **`NMR_DEBUG=1` names what sent a command to a host**, such as `delegating ci per ~/.config/nmr/config.ts (when: agent)`, `per NMR_DELEGATE`, or `per --delegate-to`.

### Choosing among several hosts

With several hosts, nmr asks every host at once, with one `ssh` call each, whether a delegation started now would wait there: whether the host's [machine lock](machine-lock.md), or the lock on this worktree's checkout there, has a live holder. A lock that its holder left behind does not count. nmr then runs on the first host in the list that is free; when none is, on the first host that answered; and when none answered, on the first host, where the delegation fails at `prepare`. It never runs the command here, because the machine that delegates is the one that delegation protects.

```console
$ NMR_DELEGATE=imac2,imac3 nmr ci
✅ my-repo: ci: passed on imac3 in 1m 52s
```

- **A single host is not asked.** The delegation goes to it directly.
- **The choice is advisory.** Two delegations that ask at the same moment can choose the same host, and then run one after the other under its locks.
- **`NMR_DEBUG=1` shows the answers**, one line per host, such as `imac2 is busy`.
- Whitespace, empty entries, and repeated hosts in the list are ignored; a `--delegate-to` value that does not name any host is refused.

The user config's `when: 'agent'` is how an agent session's checks reach the host without any change to the commands that the agent runs.

## What can be delegated

Every command whose contribution is its exit status: `ci`, `prepush`, `check`, the `test` commands, `typecheck`, and a custom script such as `test:e2e`. nmr decides on the name that the invocation gives, so `ci` runs on the host as one unit, `build` step included.

These run here, and `--delegate` and `--delegate-to` refuse them: `build`, `clean`, `compile`, `fix`, `fmt`, `lint`, `test:watch`, and `upgrade`, with their `root:` forms, which rewrite the working tree or run until stopped; and `--log`, which reads this machine's recordings. Under `NMR_DELEGATE` or the user config, they run here without comment.

## Consulting the cache first

nmr plans the command here and consults this machine's [check-result cache](check-cache.md#delegated-passes) before it contacts the host. When a recorded pass covers the tree, nmr reports the recall and does not reach the host:

```console
$ nmr --delegate-to imac2 ci
⏩ my-repo: ci: passed 4m ago on this tree, saved ~1m 48s
```

- **A pass earned here satisfies a delegation** to any host.
- **A pass earned on a host is recorded here** with that host, and a later delegation whose list includes that host recalls it as `passed 4m ago on imac2`, without asking any host whether it is free. A run here, or a delegation to other hosts, does not recall it. `nmr --log <command>` prints the output that the host sent back, under a header that names the host.
- **A delegated composite records its constituents' passes too**, as the host reports them, so `nmr --delegate-to imac2 check` after `nmr --delegate-to imac2 ci` recalls without contacting the host, and a recall of `ci` replays its constituents' excerpts. A composite that the host itself recalled records only its own pass, and a `-F` or `-R` delegation does not record any pass; [delegated passes](check-cache.md#delegated-passes) has the rules.
- **Only a miss reaches the host**, and it does not take the [machine lock](machine-lock.md) here.
- **`--no-cache` and `NMR_NO_CACHE=1` skip the lookup** and reach the host, where they bypass its cache too.
- **An invocation that nmr settles while planning**, such as an unknown command or an empty override, settles here without contacting the host.
- **A `-F` or `-R` invocation is sent whole**, without consulting this machine's cache, and the host fans it out.

## What the host runs

nmr records the working tree as it is on disk as a commit: tracked changes, staged or not, and untracked files that git does not ignore. This is the tree that a local run checks. The commit is built in a temporary index, so the repository's index, refs, and stash do not change.

nmr pushes the commit to a checkout on the host under `~/.cache/nmr/delegate/`, without running the repository's `pre-push` hook, then runs `pnpm install --frozen-lockfile` and the command from the directory that corresponds to the local one, with nmr's own flags as they were given. The host keeps one checkout for each repository on each machine that delegates to it, so concurrent delegations from different worktrees do not share one, and `node_modules` and build output persist between runs. nmr does not remove these checkouts.

- **Ignored files stay here.** A command that needs a gitignored file, such as a local `.env`, does not find it on the host.
- **A repository with submodules cannot be delegated**, nor can a tree containing a nested repository, because the snapshot does not include their content. A delegation flag refuses such a tree; under `NMR_DELEGATE` or the user config, the command runs here, and nmr prints one line saying why.

Delegations from the same worktree share its checkout on the host, so they run one at a time. A delegation that starts while another holds the checkout waits for it, saying so on stderr, then runs:

```console
$ nmr --delegate-to imac2 test
nmr: waiting for ci in /Users/me/repos/my-repo (pid 41872) to finish on imac2
```

The pid is that of the other delegation's nmr on this machine. The lock is the file `.git/nmr-delegate.lock` in the checkout, and it covers the checkout, the install, and the run, but not the push, which only transfers the snapshot. As with the machine lock, the time spent waiting does not count in the verdict's duration, and a lock left behind by an interrupted delegation is reclaimed by the next: at once when its holder's process on the host no longer exists, and otherwise once the holder has stopped refreshing the file for a minute. Delegations from different worktrees use different checkouts and do not wait for one another.

On the host, the command runs under the host's own [machine lock](machine-lock.md) and [check-result cache](check-cache.md), so a host that serves several worktrees runs their heavy commands one at a time, and a tree that already passed there skips. The host's nmr receives nmr's own flags as they were given, and the variables that decide how it reports (`NMR_COMMAND_VERBOSITY`, `NMR_OUTPUT_STYLE`, and `NMR_REPORT_FORMAT`), whether it bypasses its cache (`NMR_NO_CACHE`), whether it writes debug notes (`NMR_DEBUG`), and which run it belongs to (`NMR_RUN_ID`). An `NMR_NO_LOCK` set here does not reach the host, while `--no-lock` does. The host session sets one variable itself, `NMR_PASS_MANIFEST_DIR`, naming a directory under the checkout's `.git/` into which the host's nmr processes report their passes; the session returns those reports here when the run ends and then removes the directory.

Ctrl-C ends the delegation on the host as well as here, in every step, including the wait for the checkout.

## Reporting

The host's nmr prints its output and verdicts, and nmr here adds one verdict for the whole delegation, its transfer and install included, which names the host. `--json` adds a `host` field to that object; see [reporting for a machine](reporting.md#reporting-for-a-machine).

A failure of the delegation itself, rather than of the command, exits 255, the status with which `ssh` reports its own failures, and names the step that failed, after what that step printed:

```console
❌ my-repo: ci: failed on imac2 in 10.0s (exit 255) — could not prepare imac2
```

The steps are `prepare`, which reaches the host and creates the checkout, `push`, `check out`, and `install`. A connection lost while the command runs is reported as `lost connection to <host>`.

A delegation does not fall back to running here when it cannot reach a host. When the user config decided it and it fails at `prepare`, which is also where it fails when no host answered the probe, nmr adds a line naming the file and the remedies in order:

```console
nmr: ~/.config/nmr/config.ts sent ci to imac2, imac3; ask for network access to imac2, imac3, or run it here with nmr --no-delegate ci
```

## Setting up the host

- **SSH that does not prompt.** nmr runs `ssh` with `BatchMode=yes`, so a key that needs a passphrase must be in the agent, and the host key must already be known. An unreachable host fails within 10 seconds.
- **git, Node, and pnpm on the interactive login shell's `PATH`.** nmr reads `PATH` from the host's login shell started as an interactive one, which loads `~/.zshrc` or `~/.bashrc` as well as the login profile: That is where pnpm's installer and the common version managers put Node and pnpm. What the startup files print does not reach the output, but whatever else they do runs before each step. Node on the host must satisfy nmr's own `engines` range (`>=24.16.0`). When Node is not on that `PATH`, the check-out step fails, and when pnpm is not, the install step fails; each failure names `PATH`. The login shell must accept `-ilc`: bash and zsh do.
- **A sandboxed agent session needs network access to the host.** A sandbox that allows only HTTP egress refuses `ssh`, and the delegation fails at `prepare`. Under `when: 'agent'`, every check that the session runs fails this way until the session has that access.
