# Machine lock

nmr runs one heavy command at a time on a machine. A heavy command started while another is running, from any repository or worktree, waits for it to finish rather than competing with it for memory:

```console
$ nmr check
nmr: waiting for test in /Users/me/repos/other-repo (pid 41872) to finish
✅ my-repo: check: passed in 1m 12s
```

The waiting line goes to stderr in every verbosity and report format. The time spent waiting does not count in the verdict's duration.

## Which commands take the lock

`check`, `check:strict`, `ci`, `root:check`, `test`, `test:all`, `test:coverage`, `test:tool`, `test:unit`, `root:test`, `root:test:all`, `root:test:tool`, and `root:test:unit`, at any scope. The set is fixed.

- **`test:watch` does not take the lock.** It runs until it is stopped, and would block every other run for as long.
- **A composite takes the lock when it reaches a heavy step.** `prepush` runs its audit unlocked, then waits, if it has to, before `ci`.
- **A command nested in a heavy one runs under its hold.** The holder passes its token to the processes that it starts, so `ci` running `check:strict` running `test` takes the lock once.
- **A fan-out takes the lock once.** `nmr -R test` and `nmr -F <pattern> test` hold it in the delegating process, so the packages that pnpm runs in parallel do not wait on one another.
- **A cached pass does not wait.** nmr consults the [check-result cache](check-cache.md) before it takes the lock, and a command that the cache serves never waits. A run that did wait consults the cache again, because the run that it waited on may have recorded a pass for the same tree.
- **`--log` does not take the lock**, because it runs nothing.

## Where the lock lives

| Platform     | Directory               |
| ------------ | ----------------------- |
| Linux, macOS | `/tmp/nmr-<uid>/`       |
| Windows      | `<os.tmpdir()>/nmr/`    |
| Any          | `$NMR_LOCK_DIR`, if set |

The lock is the file `heavy.lock` in that directory. It names its holder's command, directory, and pid. The directory is `/tmp` rather than `TMPDIR` because a sandboxed agent session and a terminal shell set `TMPDIR` differently, and would not see each other's lock. `NMR_LOCK_DIR` changes the location for every invocation that sees it, so a machine that sets it sets it in every environment that runs nmr.

**A sandbox needs write access to the directory.** When nmr cannot write it, nmr warns and runs the command without the lock:

```console
nmr: running without the machine lock: cannot write /tmp/nmr-501 (EPERM). Grant write access to it, or set NMR_LOCK_DIR to a writable directory.
```

On macOS `/tmp` is a link to `/private/tmp`, and a sandbox that matches resolved paths, such as Claude Code's, needs the grant for `/private/tmp/nmr-<uid>`.

## A lock that its holder left behind

A holder removes the lock when its command ends, whether the command passed or failed. A holder that is interrupted or killed leaves the lock behind, and the next run reclaims it: at once when the holder's pid no longer exists, and otherwise once the holder has stopped refreshing the file for a minute, which covers a pid that another process has since taken.

## Bypassing the lock

| Step                      | Effect                                                     |
| ------------------------- | ---------------------------------------------------------- |
| `nmr --no-lock <command>` | Runs without waiting. Applies to the whole chain.          |
| `NMR_NO_LOCK=1`           | The same, for every nmr invocation that sees the variable. |

`--no-lock` belongs before the command name. After it, it is an argument to the command rather than a flag to nmr; nmr reports this rather than silently ignoring the bypass.

**CI.** A GitHub-hosted runner runs one job per machine, so the lock never makes it wait. A self-hosted machine that runs several runner instances serializes their heavy jobs, which protects its memory as the lock does on a workstation, and a job's wait counts against its timeout. Set `NMR_NO_LOCK=1` in the runners' environment to run them in parallel instead.

**A test suite that runs nmr.** A suite run by `nmr test` runs under that command's hold only while the processes that it starts inherit `NMR_MACHINE_LOCK_TOKEN`. A test that starts a heavy command with an environment of its own waits on the suite that started it, so it sets `NMR_NO_LOCK=1`.

## Reserved environment variables

`NMR_MACHINE_LOCK_TOKEN` is nmr's own: The holder passes it to the processes that it starts, which run under its hold. nmr honors an inherited token only while the lock file still contains it, so a process that outlives its run waits like any other.
