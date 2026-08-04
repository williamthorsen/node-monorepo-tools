/**
 * The `maxBuffer` every git invocation that pipes stdout should declare, raised well above Node's 1 MiB default
 * so a tree with thousands of untracked files still reports a status and a long-lived repo still lists its tags.
 *
 * Node enforces the cap on the parent side: it kills the child and reports `ENOBUFS` once the pipe accumulates
 * past the limit, so the child never learns why it died and the error names the spawned program rather than the
 * output that overflowed. A call site that omits the option inherits the default silently and fails only once
 * the repo it runs against has grown enough, which is why the value is shared rather than chosen per site.
 */
export const GIT_OUTPUT_LIMIT = 64 * 1_024 * 1_024;
