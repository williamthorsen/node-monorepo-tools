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

/**
 * The characters that end one command and begin the next, the doubled `&&` and `||` included.
 *
 * A newline separates two commands as `;` does, and a JSON string carries one, so an entry written across
 * lines holds as many commands as an entry written with `&&`.
 */
const SEGMENT_SEPARATORS = new Set([';', '|', '&', '\n', '\r']);

/** The characters a POSIX shell reads literally, so a token built only from them needs no quoting. */
const SHELL_SAFE_TOKEN = /^[\w@%+=:,./-]+$/;

/** Matches one whitespace character, which ends a token where it stands outside quotes. */
const WHITESPACE = /\s/;

/**
 * One element of a resolved command chain, carrying how it was composed rather than how its text reads.
 * A `structural` step is nmr's own composition, held as argv; an `opaque` step is a command nmr does not parse.
 *
 * A structural step's argv leads with the file to spawn, so the runner has one to hand `spawn` without a shell.
 *
 * `declinesArgs` travels from the composite element that composed the step to the one reader that acts on it,
 * the binding of the invocation's trailing arguments. Every stage between the two -- the devBin substitution,
 * the chain rendering, the replay assembly, the runner -- passes it through and asks nothing of it.
 */
export type Step =
  | { kind: 'opaque'; command: string }
  | { kind: 'structural'; argv: readonly [string, ...(readonly string[])]; declinesArgs?: boolean };

/** What a structural step asks of the nmr process it spawns. */
export interface NmrStepTarget {
  command: string;
  /** Whether the command is fanned out to other scopes, where a `-R` or `-F` sends it. */
  isDelegate: boolean;
  /** Whether the command runs against the root registry, where a `-w` anchors it. */
  isWorkspaceRoot: boolean;
}

/**
 * How a `package.json` entry names the command it is declared under: as its whole value, or alongside other
 * steps. `sole` covers an entry carrying trailing arguments, which declare no step of their own.
 */
export type SelfReference = 'chained' | 'sole';

/**
 * Composes the structural step that re-invokes nmr for one composite element.
 *
 * The element tokenizes on whitespace, so it may carry nmr's own flags but cannot carry a space-bearing token.
 * `-w` is prepended as its own token, so the child selects the root registry on its own.
 *
 * `declinesArgs` is set only where it holds, so a step that takes the trailing arguments renders and compares
 * exactly as it did before any element declared anything.
 */
export function composeNmrStep(element: string, workspaceRoot: boolean, declinesArgs = false): Step {
  const flags = workspaceRoot ? ['-w'] : [];
  return { kind: 'structural', argv: ['nmr', ...flags, ...tokenize(element)], ...(declinesArgs && { declinesArgs }) };
}

/**
 * Returns the text of the first opaque step that reaches nmr through a shell, or `undefined` when none does.
 *
 * Recognizes nmr in command position: at the start of the step, after `&&`, `||`, `;`, `|`, or a newline, and
 * behind a launcher such as `npx` or `pnpm exec`. A separator inside quotes opens no position, so a command
 * merely naming nmr in an argument is not a crossing.
 *
 * Partial by construction, and partial in stated ways rather than arbitrary ones: a value-taking flag standing
 * immediately before the program name hides it (`npx -p foo nmr`), and a launcher outside `LAUNCHERS` goes
 * unreported. What it finds is the boundary below which nmr cannot tell its own processes from the tools it
 * runs.
 */
export function findNmrCrossing(steps: readonly Step[]): string | undefined {
  for (const step of steps) {
    if (step.kind === 'opaque' && splitSegments(step.command).some((segment) => readNmrTail(segment) !== undefined)) {
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
 * Returns the command a structural step's nmr process runs, whether the step hands that command to other
 * scopes rather than running it where it stands, and whether it anchors the command at the monorepo root.
 * Reports nothing for a step that names no nmr command.
 *
 * The inverse of `composeNmrStep`, and beside it because the two share one grammar: an element may lead with
 * nmr's own flags, and the command is the first token that is not one.
 */
export function readNmrStep(step: Step): NmrStepTarget | undefined {
  if (step.kind !== 'structural') {
    return undefined;
  }

  const [file, ...rest] = step.argv;

  return file === 'nmr' ? readNmrTarget(rest) : undefined;
}

/**
 * Reports whether a `package.json` entry re-invokes the command it is declared under, and whether it declares
 * anything besides. Reports nothing for an entry that names another command, or none.
 *
 * Honouring such an entry would spawn a shell running the same command in the same directory, reaching the
 * same entry again without bound, so resolution discards it however it reads. `chained` is what separates an
 * entry that thereby loses steps from one that declares nothing to lose.
 *
 * A segment that delegates carries the command to other scopes rather than back to this one. `-w` re-enters
 * only from the root, a package's entry reaching the root's registry and `package.json` instead of its own.
 *
 * Partial in the same ways `findNmrCrossing` is, and for the same reason: what goes unrecognized re-enters
 * without bound, which hangs rather than passing quietly.
 */
export function readSelfReference(options: {
  anchoredAtRoot: boolean;
  commandName: string;
  script: string;
}): SelfReference | undefined {
  const { anchoredAtRoot, commandName, script } = options;

  const segments = splitSegments(script).filter((segment) => segment.trim() !== '');
  const reenters = segments.some((segment) => {
    const tail = readNmrTail(segment);
    const target = tail === undefined ? undefined : readNmrTarget(tail);

    return target?.command === commandName && !target.isDelegate && (anchoredAtRoot || !target.isWorkspaceRoot);
  });

  if (!reenters) {
    return undefined;
  }

  return segments.length === 1 ? 'sole' : 'chained';
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

/**
 * Reports whether a separator character stands inside a redirection operator rather than ending a command.
 *
 * `2>&1`, `>&2`, `<&3`, and `>|out` carry one after the redirection's own character, and `&>log` carries one
 * before it. A break there splits one command into two, which a caller counting segments reads as two steps.
 */
function isRedirectionOperator(char: string, precedingText: string, nextChar: string | undefined): boolean {
  if (char !== '&' && char !== '|') {
    return false;
  }

  return (char === '&' && nextChar === '>') || /[<>]\s*$/.test(precedingText);
}

/** Quotes a token the shell would not read literally, and leaves every other token bare. */
function quoteToken(token: string): string {
  if (SHELL_SAFE_TOKEN.test(token)) {
    return token;
  }
  return "'" + token.replaceAll("'", String.raw`'\''`) + "'";
}

/**
 * Returns the tokens an nmr invocation carries, or `undefined` for a segment that runs something else. nmr is
 * recognized whether named directly or reached through a launcher.
 */
function readNmrTail(segment: string): readonly string[] | undefined {
  const [head, ...rest] = dropLeadingAssignments(tokenizeSegment(segment));

  if (head === undefined) {
    return undefined;
  }
  if (head === 'nmr') {
    return rest;
  }

  const subcommands = LAUNCHERS.get(head);
  if (subcommands === undefined) {
    return undefined;
  }
  if (subcommands.size === 0) {
    const nameIndex = rest.findIndex((token) => !token.startsWith('-'));
    return nameIndex !== -1 && rest[nameIndex] === 'nmr' ? rest.slice(nameIndex + 1) : undefined;
  }

  const subcommandIndex = rest.findIndex((token) => subcommands.has(token));
  return subcommandIndex !== -1 && rest[subcommandIndex + 1] === 'nmr' ? rest.slice(subcommandIndex + 2) : undefined;
}

/**
 * Returns what the tokens following `nmr` ask of it: the command they name, and the flags that decide which
 * scopes run it. Reports nothing for tokens naming no command.
 *
 * The one reader of nmr's own flag grammar, shared by the argv a structural step carries and the shell segment
 * an opaque one holds, so the two cannot drift apart.
 */
function readNmrTarget(tokens: readonly string[]): NmrStepTarget | undefined {
  let isDelegate = false;
  let isWorkspaceRoot = false;
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? '';

    switch (token) {
      // The pattern is the flag's value, and reading it as a command name would name whichever package it
      // selects rather than the command every selected scope runs.
      case '-F':
      case '--filter':
        isDelegate = true;
        index += 2;
        break;
      case '-R':
      case '--recursive':
        isDelegate = true;
        index += 1;
        break;
      case '-w':
      case '--workspace-root':
        isWorkspaceRoot = true;
        index += 1;
        break;
      default:
        if (!token.startsWith('-')) {
          return { command: token, isDelegate, isWorkspaceRoot };
        }
        index += 1;
    }
  }

  return undefined;
}

/** Renders one step as the text a shell runs. */
function renderStep(step: Step): string {
  return step.kind === 'opaque' ? step.command : step.argv.map(quoteToken).join(' ');
}

/**
 * Splits a command into the segments a shell would run as separate commands, breaking on `&&`, `||`, `;`, `|`,
 * and a newline, outside quotes.
 *
 * Quote and escape state are tracked character by character rather than by matching tokens, so a separator
 * standing inside an argument stays part of the segment holding it. A backslash escapes outside quotes and
 * inside a double-quoted run; inside a single-quoted run the shell reads it literally, and so does this.
 * `tokenizeSegment` tracks the same state on the same rules.
 *
 * A separator standing inside a redirection operator ends no command, so `nmr build 2>&1` is one segment.
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
      if (isRedirectionOperator(char, current, command[index + 1])) {
        current += char;
        index += 1;
        continue;
      }

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

/**
 * Splits a shell segment into the tokens a shell reads, keeping a quoted run attached to the token holding
 * it, so an environment assignment carrying a quoted space stays one token.
 *
 * Tracks quote and escape state as `splitSegments` does, the two sharing one set of rules.
 *
 * Keeps the quotes rather than stripping them: both questions asked of a token, whether it assigns an
 * environment variable and whether it names the program, read the same on the raw token.
 */
function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | undefined;
  let index = 0;

  while (index < segment.length) {
    const char = segment[index] ?? '';

    if (quote !== undefined) {
      if (char === '\\' && quote === '"') {
        current += char + (segment[index + 1] ?? '');
        index += 2;
        continue;
      }
      current += char;
      if (char === quote) quote = undefined;
      index += 1;
      continue;
    }

    if (char === '\\') {
      current += char + (segment[index + 1] ?? '');
      index += 2;
      continue;
    }

    if (QUOTES.has(char)) {
      quote = char;
      current += char;
      index += 1;
      continue;
    }

    if (WHITESPACE.test(char)) {
      if (current !== '') {
        tokens.push(current);
      }
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (current !== '') {
    tokens.push(current);
  }
  return tokens;
}

// endregion | Helpers
