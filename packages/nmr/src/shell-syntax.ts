/** Matches the `NAME=value` assignment that a shell consumes before the program name. */
const ENV_ASSIGNMENT = /^\w+=/;

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

/** Drops the leading `NAME=value` assignments, leaving the program name at the head. */
export function dropLeadingAssignments(tokens: readonly string[]): readonly string[] {
  const start = tokens.findIndex((token) => !ENV_ASSIGNMENT.test(token));
  return start === -1 ? [] : tokens.slice(start);
}

/** Reports whether a POSIX shell reads the token literally, so that it does not need any quoting. */
export function isShellSafeToken(token: string): boolean {
  return SHELL_SAFE_TOKEN.test(token);
}

/** Quotes a token that the shell would not read literally, and leaves every other token bare. */
export function quoteToken(token: string): string {
  if (isShellSafeToken(token)) {
    return token;
  }
  return "'" + token.replaceAll("'", String.raw`'\''`) + "'";
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
export function splitSegments(command: string): string[] {
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
export function tokenize(element: string): string[] {
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
export function tokenizeSegment(segment: string): string[] {
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

// region | Helpers

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

// endregion | Helpers
