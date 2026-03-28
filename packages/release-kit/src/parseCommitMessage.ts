import type { ParsedCommit, WorkTypeConfig } from './types.ts';

/**
 * Regex patterns stripped from the start of commit messages before parsing.
 *
 * Kept in sync with `commit_preprocessors` in cliff.toml.template so that
 * both git-cliff and this parser see the same normalized messages.
 */
export const COMMIT_PREPROCESSOR_PATTERNS: readonly RegExp[] = [/^#\d+\s+/, /^[A-Z]+-\d+\s+/];

/**
 * Parse a commit message into structured metadata.
 *
 * Supports both `type: description` and `workspace|type: description` formats.
 * Resolves aliases (e.g., 'feature' -> 'feat') using the provided work type configs.
 * Resolves workspace aliases when a `workspaceAliases` map is provided.
 * Detects breaking changes via `type!:` or `BREAKING CHANGE:` in the message.
 */
export function parseCommitMessage(
  message: string,
  hash: string,
  workTypes: Record<string, WorkTypeConfig>,
  workspaceAliases?: Record<string, string>,
): ParsedCommit | undefined {
  // Strip ticket prefixes (e.g., "#8 " or "TOOL-123 ") before matching
  const stripped = stripTicketPrefix(message);

  // Match both `type: desc` and `workspace|type: desc` formats
  // The `!` before `:` indicates a breaking change
  const match = stripped.match(/^(?:([^|]+)\|)?(\w+)(!)?:\s*(.*)$/);
  if (!match) {
    return undefined;
  }

  const workspace = match[1];
  const rawType = match[2];
  const breakingMarker = match[3];
  const description = match[4];

  if (rawType === undefined || description === undefined) {
    return undefined;
  }

  // Resolve aliases
  const resolvedType = resolveType(rawType, workTypes);
  if (resolvedType === undefined) {
    return undefined;
  }

  const breaking = breakingMarker === '!' || message.includes('BREAKING CHANGE:');

  // Resolve workspace alias to canonical name if a mapping is provided
  const resolvedWorkspace =
    workspace !== undefined && workspaceAliases !== undefined ? (workspaceAliases[workspace] ?? workspace) : workspace;

  return {
    message,
    hash,
    type: resolvedType,
    description,
    breaking,
    ...(resolvedWorkspace !== undefined && { workspace: resolvedWorkspace }),
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
