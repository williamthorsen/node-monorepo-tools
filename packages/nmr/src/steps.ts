/** Matches the `NAME=value` assignment that a shell consumes before the program name. */
const ENV_ASSIGNMENT = /^\w+=/;

/**
 * The programs that run another program named by a later token, each mapped to the subcommands through which
 * it runs a binary. An empty set means the program follows the launcher directly, after any flags.
 *
 * Requiring the subcommand for the rest keeps `pnpm --filter nmr build` from reading as a crossing in a repo
 * containing a package named `nmr`, and `pnpm run nmr` from reading as one at all: That runs a script by that
 * name, not the binary.
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
 * A newline separates two commands as `;` does, and a JSON string can contain one, so an entry written across
 * lines contains as many commands as an entry written with `&&`.
 */
const SEGMENT_SEPARATORS = new Set([';', '|', '&', '\n', '\r']);

/** The characters that a POSIX shell reads literally. A token built only from them does not need any quoting. */
const SHELL_SAFE_TOKEN = /^[\w@%+=:,./-]+$/;

/**
 * The characters that end one token and begin the next: a shell's default IFS, and the carriage return in a
 * `\r\n` line ending. A shell reads every other character inside the word that contains it.
 */
const TOKEN_SEPARATORS = new Set([' ', '\t', '\n', '\r']);

/**
 * One element of a resolved command chain, recording how it was composed rather than how its text reads.
 * A `structural` step is nmr's own composition, stored as argv; an `opaque` step is a command that nmr does not
 * parse.
 *
 * A structural step's argv leads with the file to spawn, so the runner has one to hand `spawn` without a shell.
 *
 * `shouldDeclineArguments` is passed from the composite element that composed the step to the one reader that acts
 * on it, the binding of the invocation's trailing arguments. Every stage between the two passes it through unread.
 *
 * `shouldWithholdInput` is read by the runner alone, which gives the step's child the null device as stdin rather
 * than nmr's own. Like `shouldDeclineArguments`, it is set only when it holds and leaves the rendered chain unchanged.
 */
export type Step =
  | { kind: 'opaque'; command: string }
  | {
      kind: 'structural';
      argv: readonly [string, ...(readonly string[])];
      shouldDeclineArguments?: boolean;
      shouldWithholdInput?: boolean;
    };

/** What a structural step asks of the nmr process that it spawns. */
export interface NmrStepTarget {
  command: string;
  /** Whether the command is fanned out to other scopes, as it is when a `-R` or `-F` sends it. */
  isDelegate: boolean;
  /**
   * Whether the command is fanned out to every package, as it is when a `-R` sends it. A separate field rather
   * than a narrowing of `isDelegate`, whose reader surveys the scopes that a `-F` may also have reached.
   */
  isRecursive: boolean;
  /** Whether the command runs against the root registry, as it does when a `-w` anchors it. */
  isWorkspaceRoot: boolean;
}

/**
 * How a `package.json` entry names the command under which it is declared: as its whole value, or alongside
 * other steps. `sole` covers an entry with trailing arguments, which do not declare a step of their own.
 */
export type SelfReference = 'chained' | 'sole';

/**
 * Composes the structural step that re-invokes nmr for one composite element.
 *
 * The element tokenizes on whitespace, so it may contain nmr's own flags but cannot contain a space-bearing
 * token. `-w` is prepended as its own token: The child selects the root registry on its own.
 *
 * Because `shouldDeclineArguments` is set only when it holds, a step that takes the trailing arguments compares
 * equal to one composed without the option.
 */
export function composeNmrStep(element: string, isWorkspaceRoot: boolean, shouldDeclineArguments = false): Step {
  const flags = isWorkspaceRoot ? ['-w'] : [];
  return {
    kind: 'structural',
    argv: ['nmr', ...flags, ...tokenize(element)],
    ...(shouldDeclineArguments && { shouldDeclineArguments }),
  };
}

/**
 * Returns the steps that still run in a workspace without any package: every step but the ones that a `-R` fans
 * out.
 *
 * A `-F` step is kept. It names one package, and its absence is a real error whoever composed the step, whereas
 * a `-R` asked for every package and a workspace with none has nothing for it to do.
 */
export function dropRecursiveSteps(steps: readonly Step[]): Step[] {
  return steps.filter((step) => readNmrStep(step)?.isRecursive !== true);
}

/**
 * Returns the text of the first opaque step that runs nmr through a shell, or `undefined` when none does.
 *
 * Recognizes nmr in command position: at the start of the step, after `&&`, `||`, `;`, `|`, or a newline, past
 * any leading environment assignments, and behind a launcher such as `npx` or `pnpm exec`. A separator inside
 * quotes does not open a command position, so a command merely naming nmr in an argument is not a crossing.
 *
 * Partial by construction, and partial in stated ways rather than arbitrary ones: A value-taking flag standing
 * immediately before the program name hides it (`npx -p foo nmr`), and a launcher outside `LAUNCHERS` goes
 * unreported. What it finds is the boundary below which nmr cannot tell its own processes from the tools that
 * it runs.
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
 * element is a command name optionally preceded by nmr's own flags. A token that the shell would not read
 * literally would be quoted whole by the rendering, turning the element into a command that nobody wrote.
 */
export function findUnexpressibleToken(element: string): string | undefined {
  return tokenize(element).find((token) => !SHELL_SAFE_TOKEN.test(token));
}

/**
 * Returns the command that a structural step's nmr process runs, whether the step hands that command to other
 * scopes rather than running it in its own scope, and whether it anchors the command at the monorepo root.
 * Reports nothing for a step that does not name an nmr command.
 *
 * The inverse of `composeNmrStep`, and beside it because the two share one grammar: An element may lead with
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
 * Reports whether a `package.json` entry re-invokes the command under which it is declared, and whether it
 * declares anything besides. Reports nothing for an entry that names another command, or none.
 *
 * Honouring such an entry would spawn a shell running the same command in the same directory, which reads the
 * same entry again without bound, so resolution discards it however it reads. `chained` separates an entry that
 * thereby loses steps from one that declares nothing to lose.
 *
 * A segment that delegates sends the command to other scopes rather than back to this one. `-w` re-enters
 * only from the root, a package's `-w` entry resolving against the root's registry and `package.json` instead of its own.
 *
 * Partial in the same ways `findNmrCrossing` is, and for the same reason: What goes unrecognized re-enters
 * without bound, which hangs rather than passing quietly.
 */
export function readSelfReference(options: {
  anchoredAtRoot: boolean;
  commandName: string;
  script: string;
}): SelfReference | undefined {
  const { anchoredAtRoot, commandName, script } = options;

  const segments = splitSegments(script).filter((segment) => segment.trim() !== '');
  const doesReenter = segments.some((segment) => {
    const tail = readNmrTail(segment);
    const target = tail === undefined ? undefined : readNmrTarget(tail);

    return target?.command === commandName && !target.isDelegate && (anchoredAtRoot || !target.isWorkspaceRoot);
  });

  if (!doesReenter) {
    return undefined;
  }

  return segments.length === 1 ? 'sole' : 'chained';
}

/**
 * Renders a step list as the `&&` chain that a shell runs.
 *
 * The sole producer of a chain string: The check-result cache keys on that string, so a change to the rendering
 * invalidates every recorded pass.
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
 * `2>&1`, `>&2`, `<&3`, and `>|out` contain one after the redirection's own character, and `&>log` contains one
 * before it. A break there splits one command into two, which a caller counting segments reads as two steps.
 */
function isRedirectionOperator(char: string, precedingText: string, nextChar: string | undefined): boolean {
  if (char !== '&' && char !== '|') {
    return false;
  }

  return (char === '&' && nextChar === '>') || /[<>]\s*$/.test(precedingText);
}

/** Quotes a token that the shell would not read literally, and leaves every other token bare. */
function quoteToken(token: string): string {
  if (SHELL_SAFE_TOKEN.test(token)) {
    return token;
  }
  return "'" + token.replaceAll("'", String.raw`'\''`) + "'";
}

/**
 * Returns the tokens in an nmr invocation, or `undefined` for a segment that runs something else. nmr is
 * recognized whether named directly or run through a launcher.
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
 * scopes run it. Reports nothing for tokens that do not name a command.
 *
 * The one reader of nmr's own flag grammar, shared by the argv of a structural step and the shell segment of an
 * opaque one, so the two cannot drift apart.
 */
function readNmrTarget(tokens: readonly string[]): NmrStepTarget | undefined {
  let isDelegate = false;
  let isRecursive = false;
  let isWorkspaceRoot = false;
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? '';

    switch (token) {
      // The pattern is the flag's value, and reading it as a command name would name whichever package it
      // selects rather than the command that every selected scope runs.
      case '-F':
      case '--filter':
        isDelegate = true;
        index += 2;
        break;
      case '-R':
      case '--recursive':
        isDelegate = true;
        isRecursive = true;
        index += 1;
        break;
      case '-w':
      case '--workspace-root':
        isWorkspaceRoot = true;
        index += 1;
        break;
      default:
        if (!token.startsWith('-')) {
          return { command: token, isDelegate, isRecursive, isWorkspaceRoot };
        }
        index += 1;
    }
  }

  return undefined;
}

/** Renders one step as the text that a shell runs. */
function renderStep(step: Step): string {
  return step.kind === 'opaque' ? step.command : step.argv.map(quoteToken).join(' ');
}

/**
 * Splits a command into the segments that a shell would run as separate commands, breaking on `&&`, `||`, `;`,
 * `|`, and a newline, outside quotes.
 *
 * Quote and escape state are tracked character by character rather than by matching tokens, so a separator
 * standing inside an argument stays part of the segment containing it. A backslash escapes outside quotes and
 * inside a double-quoted run; inside a single-quoted run the shell reads it literally, and so does this.
 * `tokenizeSegment` tracks the same state on the same rules.
 *
 * A separator standing inside a redirection operator does not end a command: `nmr build 2>&1` is one segment.
 */
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let currentSegment = '';
  let quote: string | undefined;
  let index = 0;

  while (index < command.length) {
    const char = command[index] ?? '';

    if (quote !== undefined) {
      if (char === '\\' && quote === '"') {
        currentSegment += char + (command[index + 1] ?? '');
        index += 2;
        continue;
      }
      currentSegment += char;
      if (char === quote) quote = undefined;
      index += 1;
      continue;
    }

    if (char === '\\') {
      currentSegment += char + (command[index + 1] ?? '');
      index += 2;
      continue;
    }

    if (QUOTES.has(char)) {
      quote = char;
      currentSegment += char;
      index += 1;
      continue;
    }

    if (SEGMENT_SEPARATORS.has(char)) {
      if (isRedirectionOperator(char, currentSegment, command[index + 1])) {
        currentSegment += char;
        index += 1;
        continue;
      }

      // `&&` and `||` use two characters for the break, whereas a lone `&` or `|` uses one.
      index += command[index + 1] === char ? 2 : 1;
      segments.push(currentSegment);
      currentSegment = '';
      continue;
    }

    currentSegment += char;
    index += 1;
  }

  segments.push(currentSegment);
  return segments;
}

/** Splits a composite element into argv tokens, dropping the empty tokens that surrounding whitespace would leave. */
function tokenize(element: string): string[] {
  return element.split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Splits a shell segment into the tokens that a shell reads, keeping a quoted run attached to the token
 * containing it, so that an environment assignment containing a quoted space stays one token.
 *
 * Tracks quote and escape state as `splitSegments` does, the two sharing one set of rules.
 *
 * Keeps the quotes rather than stripping them: Both questions asked of a token, whether it assigns an
 * environment variable and whether it names the program, read the same on the raw token.
 */
function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let currentToken = '';
  let quote: string | undefined;
  let index = 0;

  while (index < segment.length) {
    const char = segment[index] ?? '';

    if (quote !== undefined) {
      if (char === '\\' && quote === '"') {
        currentToken += char + (segment[index + 1] ?? '');
        index += 2;
        continue;
      }
      currentToken += char;
      if (char === quote) quote = undefined;
      index += 1;
      continue;
    }

    if (char === '\\') {
      currentToken += char + (segment[index + 1] ?? '');
      index += 2;
      continue;
    }

    if (QUOTES.has(char)) {
      quote = char;
      currentToken += char;
      index += 1;
      continue;
    }

    if (TOKEN_SEPARATORS.has(char)) {
      if (currentToken !== '') {
        tokens.push(currentToken);
      }
      currentToken = '';
      index += 1;
      continue;
    }

    currentToken += char;
    index += 1;
  }

  if (currentToken !== '') {
    tokens.push(currentToken);
  }
  return tokens;
}

// endregion | Helpers
