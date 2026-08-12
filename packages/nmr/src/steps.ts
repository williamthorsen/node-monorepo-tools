/** Matches the `NAME=value` assignment a shell consumes before the program name. */
const ENV_ASSIGNMENT = /^\w+=/;

/**
 * The programs that run another program named by a later token, each mapped to the subcommands through which
 * it reaches a binary. An empty set means the program follows the launcher directly, after any flags.
 *
 * Requiring the subcommand for the rest is what keeps `pnpm --filter nmr build` from reading as a crossing in
 * a repo holding a package named `nmr`, and `pnpm run nmr` from reading as one at all: that runs a script by
 * that name, not the binary.
 */
const LAUNCHERS = new Map<string, ReadonlySet<string>>([
  ['bun', new Set(['x'])],
  ['bunx', new Set()],
  ['npm', new Set(['exec'])],
  ['npx', new Set()],
  ['pnpm', new Set(['dlx', 'exec'])],
  ['yarn', new Set(['dlx', 'exec'])],
]);

/** The characters that open a quoted run, inside which a separator is read literally. */
const QUOTES = new Set(['"', "'"]);

/** The characters that end one command and begin the next, the doubled `&&` and `||` included. */
const SEGMENT_SEPARATORS = new Set([';', '|', '&']);

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

/** What a structural step asks of the nmr process it spawns. */
export interface NmrStepTarget {
  command: string;
  /** Whether the command is fanned out to other scopes, where a `-R` or `-F` sends it. */
  isDelegate: boolean;
}

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
 * Recognizes nmr in command position: at the start of the step, after `&&`, `||`, `;`, or `|`, and behind a
 * launcher such as `npx` or `pnpm exec`. A separator inside quotes opens no position, so a command merely
 * naming nmr in an argument is not a crossing.
 *
 * Partial by construction, and partial in stated ways rather than arbitrary ones: a value-taking flag standing
 * immediately before the program name hides it (`npx -p foo nmr`), and a launcher outside `LAUNCHERS` goes
 * unreported. What it finds is the boundary below which nmr cannot tell its own processes from the tools it
 * runs.
 */
export function findNmrCrossing(steps: readonly Step[]): string | undefined {
  for (const step of steps) {
    if (step.kind === 'opaque' && splitSegments(step.command).some(reachesNmr)) {
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
 * Returns the command a structural step's nmr process runs, and whether the step hands that command to other
 * scopes rather than running it where it stands. Reports nothing for a step that names no nmr command.
 *
 * The inverse of `composeNmrStep`, and beside it because the two share one grammar: an element may lead with
 * nmr's own flags, and the command is the first token that is not one.
 */
export function readNmrStep(step: Step): NmrStepTarget | undefined {
  if (step.kind !== 'structural') {
    return undefined;
  }

  const [file, ...rest] = step.argv;
  if (file !== 'nmr') {
    return undefined;
  }

  let isDelegate = false;
  let index = 0;

  while (index < rest.length) {
    const token = rest[index] ?? '';

    if (token === '-F' || token === '--filter') {
      // The pattern is the flag's value, and reading it as a command name would name whichever package it
      // selects rather than the command every selected scope runs.
      isDelegate = true;
      index += 2;
    } else if (token === '-R' || token === '--recursive') {
      isDelegate = true;
      index += 1;
    } else if (token.startsWith('-')) {
      index += 1;
    } else {
      return { command: token, isDelegate };
    }
  }

  return undefined;
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

/** Drops the leading `NAME=value` assignments, leaving the program name at the head. */
function dropLeadingAssignments(tokens: readonly string[]): readonly string[] {
  const start = tokens.findIndex((token) => !ENV_ASSIGNMENT.test(token));
  return start === -1 ? [] : tokens.slice(start);
}

/** Quotes a token the shell would not read literally, and leaves every other token bare. */
function quoteToken(token: string): string {
  if (SHELL_SAFE_TOKEN.test(token)) {
    return token;
  }
  return "'" + token.replaceAll("'", String.raw`'\''`) + "'";
}

/** Reports whether a segment runs nmr, whether named directly or reached through a launcher. */
function reachesNmr(segment: string): boolean {
  const [head, ...rest] = dropLeadingAssignments(tokenize(segment));

  if (head === undefined) {
    return false;
  }
  if (head === 'nmr') {
    return true;
  }

  const subcommands = LAUNCHERS.get(head);
  if (subcommands === undefined) {
    return false;
  }
  if (subcommands.size === 0) {
    return rest.find((token) => !token.startsWith('-')) === 'nmr';
  }

  const subcommandIndex = rest.findIndex((token) => subcommands.has(token));
  return subcommandIndex !== -1 && rest[subcommandIndex + 1] === 'nmr';
}

/** Renders one step as the text a shell runs. */
function renderStep(step: Step): string {
  return step.kind === 'opaque' ? step.command : step.argv.map(quoteToken).join(' ');
}

/**
 * Splits a command into the segments a shell would run as separate commands, breaking on `&&`, `||`, `;`, and
 * `|` outside quotes.
 *
 * Quote and escape state are tracked character by character rather than by matching tokens, so a separator
 * standing inside an argument stays part of the segment holding it. A backslash escapes outside quotes and
 * inside a double-quoted run; inside a single-quoted run the shell reads it literally, and so does this.
 */
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | undefined;
  let index = 0;

  while (index < command.length) {
    const char = command[index] ?? '';

    if (quote !== undefined) {
      if (char === '\\' && quote === '"') {
        current += char + (command[index + 1] ?? '');
        index += 2;
        continue;
      }
      current += char;
      if (char === quote) quote = undefined;
      index += 1;
      continue;
    }

    if (char === '\\') {
      current += char + (command[index + 1] ?? '');
      index += 2;
      continue;
    }

    if (QUOTES.has(char)) {
      quote = char;
      current += char;
      index += 1;
      continue;
    }

    if (SEGMENT_SEPARATORS.has(char)) {
      // `&&` and `||` spend two characters on the break a lone `&` or `|` spends one on.
      index += command[index + 1] === char ? 2 : 1;
      segments.push(current);
      current = '';
      continue;
    }

    current += char;
    index += 1;
  }

  segments.push(current);
  return segments;
}

/** Splits a composite element into argv tokens, dropping the empties surrounding whitespace would leave. */
function tokenize(element: string): string[] {
  return element.split(/\s+/).filter((token) => token.length > 0);
}

// endregion | Helpers
