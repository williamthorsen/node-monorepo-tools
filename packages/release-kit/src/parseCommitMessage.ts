import type { ParsedCommit, WorkTypeConfig } from './types.ts';

/**
 * Parses a commit message into structured metadata.
 *
 * Supports both `type: description` and `workspace|type: description` formats.
 * Resolves aliases (e.g., 'feature' -> 'feat') using the provided work type configs.
 * Resolves workspace aliases when a `workspaceAliases` map is provided.
 * Detects breaking changes via `type!:` or `BREAKING CHANGE:` in the message.
 *
 * @param message - The commit message (first line).
 * @param hash - The commit hash.
 * @param workTypes - Record of work type configurations keyed by canonical type name.
 * @param workspaceAliases - Optional map of workspace shorthand names to canonical names.
 * @returns A parsed commit, or undefined if the message does not match a known format.
 */
export function parseCommitMessage(
  message: string,
  hash: string,
  workTypes: Record<string, WorkTypeConfig>,
  workspaceAliases?: Record<string, string>,
): ParsedCommit | undefined {
  // Match both `type: desc` and `workspace|type: desc` formats
  // The `!` before `:` indicates a breaking change
  const match = message.match(/^(?:([^|]+)\|)?(\w+)(!)?:\s*(.*)$/);
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
