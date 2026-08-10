/** The characters a POSIX shell reads literally, so a token built only from them needs no quoting. */
const SHELL_SAFE_TOKEN = /^[\w@%+=:,./-]+$/;

/**
 * One element of a resolved command chain, carrying how it was composed rather than how its text reads.
 * A `structural` step is nmr's own composition, held as argv; an `opaque` step is a command nmr does not parse.
 *
 * A structural step's argv leads with the file to spawn, so the runner has one to hand `spawn` without a shell.
 */
export type Step =
  { kind: 'opaque'; command: string } | { kind: 'structural'; argv: readonly [string, ...(readonly string[])] };

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
 * Returns the text of the first opaque step that reaches nmr through a shell, or `undefined` when none does.
 *
 * A partial detector rather than a rule: only a step leading with the token `nmr` is recognized, so one
 * reaching nmr through another program is not, and a tier-3 `package.json` override is a plain string with no
 * step list to be expressed as. What it finds is the boundary below which nmr cannot tell its own processes
 * from the tools it runs.
 */
export function findShelledNmrStep(steps: readonly Step[]): string | undefined {
  for (const step of steps) {
    if (step.kind === 'opaque' && tokenize(step.command)[0] === 'nmr') {
      return step.command;
    }
  }
  return undefined;
}

/**
 * Returns the first token of a composite element that falls outside the grammar, or `undefined` when the
 * element is a command name optionally preceded by nmr's own flags. A token the shell would not read
 * literally is one the rendering would quote whole, turning the element into a command nobody wrote.
 */
export function findUnexpressibleToken(element: string): string | undefined {
  return tokenize(element).find((token) => !SHELL_SAFE_TOKEN.test(token));
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
