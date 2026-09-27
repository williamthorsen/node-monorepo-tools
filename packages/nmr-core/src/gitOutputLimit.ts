/**
 * The `maxBuffer` for every git invocation that pipes stdout, raised well above Node's 1 MiB default so that a
 * tree with thousands of untracked files still reports a status and a long-lived repo still lists its tags.
 *
 * Past the limit, Node kills the child and reports `ENOBUFS`, an error that names the spawned program rather than
 * the output that overflowed. A call site that omits the option fails this way only once its repo has grown enough.
 */
export const GIT_OUTPUT_LIMIT = 64 * 1_024 * 1_024;
