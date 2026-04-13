import type { ParsedCommit, WorkTypeConfig } from './types.ts';

/** Regex patterns stripped from the start of commit messages before parsing. */
export const COMMIT_PREPROCESSOR_PATTERNS: readonly RegExp[] = [/^#\d+\s+/, /^[A-Z]+-\d+\s+/];

/**
 * Parse a commit message into structured metadata.
 *
 * Supports three formats:
 * - `type: description`
 * - `scope|type: description` (pipe-prefixed scope)
 * - `type(scope): description` (conventional commit parenthesized scope)
 *
 * Resolves aliases (e.g., 'feature' -> 'feat') using the provided work type configs.
 * Resolves scope aliases when a `scopeAliases` map is provided.
 * Detects breaking changes via `type!:` or `BREAKING CHANGE:` in the message.
 */
export function parseCommitMessage(
  message: string,
  hash: string,
  workTypes: Record<string, WorkTypeConfig>,
  scopeAliases?: Record<string, string>,
): ParsedCommit | undefined {
  // Strip ticket prefixes (e.g., "#8 " or "TOOL-123 ") before matching
  const stripped = stripTicketPrefix(message);

  // Match pipe-prefixed scope, type, optional parenthesized scope, breaking marker, description.
  // Group 1: pipe-prefixed scope (e.g., "web" in "web|feat: ...")
  // Group 2: type (e.g., "feat")
  // Group 3: parenthesized scope (e.g., "parser" in "fix(parser): ...")
  // Group 4: breaking marker ("!")
  // Group 5: description
  const match = stripped.match(/^(?:([^|]+)\|)?(\w+)(?:\(([^)]+)\))?(!)?:\s*(.*)$/);
  if (!match) {
    return undefined;
  }

  const pipeScope = match[1];
  const rawType = match[2];
  const parenthesizedScope = match[3];
  const breakingMarker = match[4];
  const description = match[5];

  // Both groups are non-optional in the regex, but TypeScript cannot infer that
  if (rawType === undefined || description === undefined) {
    return undefined;
  }

  // Resolve aliases
  const resolvedType = resolveType(rawType, workTypes);
  if (resolvedType === undefined) {
    return undefined;
  }

  const breaking = breakingMarker === '!' || message.includes('BREAKING CHANGE:');

  // Pipe scope takes precedence; fall back to parenthesized scope
  const rawScope = pipeScope ?? parenthesizedScope;

  // Resolve scope alias to canonical name if a mapping is provided
  const resolvedScope =
    rawScope !== undefined && scopeAliases !== undefined ? (scopeAliases[rawScope] ?? rawScope) : rawScope;

  return {
    message,
    hash,
    type: resolvedType,
    description,
    breaking,
    ...(resolvedScope !== undefined && { scope: resolvedScope }),
  };
}

/**
 * Resolves a raw type string to its canonical type name using the record keys and aliases.
 */
function resolveType(rawType: string, workTypes: Record<string, WorkTypeConfig>): string | undefined {
  const lowered = rawType.toLowerCase();

  for (const [key, config] of Object.entries(workTypes)) {
    if (key === lowered) {
      return key;
    }
    if (config.aliases !== undefined) {
      for (const alias of config.aliases) {
        if (alias === lowered) {
          return key;
        }
      }
    }
  }

  return undefined;
}

/** Remove ticket-prefix patterns (e.g., "#8 " or "TOOL-123 ") from the start of a message. */
function stripTicketPrefix(message: string): string {
  let result = message;
  for (const pattern of COMMIT_PREPROCESSOR_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result;
}
