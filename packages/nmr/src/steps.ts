/** The characters a POSIX shell reads literally, so a token built only from them needs no quoting. */
const SHELL_SAFE_TOKEN = /^[\w@%+=:,./-]+$/;

/**
 * One element of a resolved command chain, carrying how it was composed rather than how its text reads.
 * A `structural` step is nmr's own composition, held as argv; an `opaque` step is a command nmr does not parse.
 */
export type Step = { kind: 'opaque'; command: string } | { kind: 'structural'; argv: readonly string[] };

/**
 * Composes the structural step that re-invokes nmr for one composite element.
 *
 * The element tokenizes on whitespace, so it may carry nmr's own flags but cannot carry a space-bearing token.
 * `-w` is prepended as its own token, so the child selects the root registry on its own.
 */
export function composeNmrStep(element: string, workspaceRoot: boolean): Step {
  const flags = workspaceRoot ? ['-w'] : [];
  return { kind: 'structural', argv: ['nmr', ...flags, ...tokenize(element)] };
}

/**
 * Renders a step list as the `&&` chain a shell runs.
 *
 * The sole producer of a chain string: the check-result cache keys on that string, so a change to the rendering
 * invalidates every recorded pass by construction rather than by anyone remembering to.
 */
export function renderChain(steps: readonly Step[]): string {
  return steps.map(renderStep).join(' && ');
}

// region | Helpers

/** Quotes a token the shell would not read literally, and leaves every other token bare. */
function quoteToken(token: string): string {
  if (SHELL_SAFE_TOKEN.test(token)) {
    return token;
  }
  return "'" + token.replaceAll("'", String.raw`'\''`) + "'";
}

/** Renders one step as the text a shell runs. */
function renderStep(step: Step): string {
  return step.kind === 'opaque' ? step.command : step.argv.map(quoteToken).join(' ');
}

/** Splits a composite element into argv tokens, dropping the empties surrounding whitespace would leave. */
function tokenize(element: string): string[] {
  return element.split(/\s+/).filter((token) => token.length > 0);
}

// endregion | Helpers
