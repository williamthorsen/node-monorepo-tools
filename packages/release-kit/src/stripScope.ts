import { COMMIT_PREPROCESSOR_PATTERNS, PIPE_SCOPE_SOURCE } from './parseCommitMessage.ts';

/** Matches a pipe-prefixed scope, capturing the remainder of the subject. */
const PIPE_SCOPE_PATTERN = new RegExp(String.raw`^${PIPE_SCOPE_SOURCE}\|(.*)$`);

/**
 * Strip scope indicators from a raw commit message.
 *
 * Handles `scope|type: desc`, `type(scope): desc`, and messages with
 * ticket prefixes (e.g., `#72 release-kit|fix: ...`). Returns the
 * message unchanged when no scope is detected.
 */
export function stripScope(message: string): string {
  // Detect and remove ticket prefix so we can parse the remainder.
  let ticketPrefix = '';
  let remainder = message;

  for (const pattern of COMMIT_PREPROCESSOR_PATTERNS) {
    const match = remainder.match(pattern);
    if (match) {
      ticketPrefix += match[0];
      remainder = remainder.slice(match[0].length);
    }
  }

  const pipeMatch = remainder.match(PIPE_SCOPE_PATTERN);
  if (pipeMatch) {
    return `${ticketPrefix}${pipeMatch[1]}`;
  }

  // Try parenthesized scope: `type(scope): desc` or `type(scope)!: desc`
  const parenMatch = remainder.match(/^(\w+)\([^)]+\)(.*)$/);
  if (parenMatch) {
    return `${ticketPrefix}${parenMatch[1]}${parenMatch[2]}`;
  }

  return message;
}
