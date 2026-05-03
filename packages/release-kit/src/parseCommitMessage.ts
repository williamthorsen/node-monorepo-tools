import type { Commit, ParsedCommit, WorkTypeConfig } from './types.ts';

/** Regex patterns stripped from the start of commit messages before parsing. */
export const COMMIT_PREPROCESSOR_PATTERNS: readonly RegExp[] = [/^##\s+/, /^#\d+([.-]\d+)?\s+/, /^[A-Z]+-\d+\s+/];

/** Surface where a `!`/`BREAKING CHANGE:` policy violation was detected. */
export type PolicyViolationSurface = 'prefix' | 'body';

/**
 * Callback invoked when `parseCommitMessage` detects a `!`-policy violation.
 *
 * Two-tier policy: at write-time (commit-msg hook, OOS for ticket #355), violations are
 * rejected outright; at release-time (this parser), violations are warn-and-continue so
 * legacy log entries don't block releases. Callers (`decideRelease`, `releasePrepareMono`,
 * etc.) collect callback invocations and surface them in the release report.
 */
export type PolicyViolationHandler = (commit: Commit, type: string, surface: PolicyViolationSurface) => void;

/** Optional configuration for `parseCommitMessage` beyond the core inputs. */
export interface ParseCommitMessageOptions {
  /**
   * Per-type breaking-policy lookup keyed by canonical type name. Missing entries are
   * treated as `'optional'` for backward compatibility with consumers that have not
   * supplied policies.
   */
  breakingPolicies?: Record<string, 'forbidden' | 'optional' | 'required'>;
  /** Receives policy-violation notifications. See {@link PolicyViolationHandler}. */
  onPolicyViolation?: PolicyViolationHandler;
}

/**
 * Parse a commit message into structured metadata.
 *
 * Supports three formats:
 * - `type: description`
 * - `scope|type: description` (pipe-prefixed scope)
 * - `type(scope): description` (conventional commit parenthesized scope)
 *
 * Resolves aliases (e.g., `feature` → `feat`) using the provided work-type configs and the
 * canonical aliases list. Resolves scope aliases when a `scopeAliases` map is provided.
 * Detects breaking changes via `type!:` or `BREAKING CHANGE:` in the message.
 *
 * `!`-policy enforcement is **release-time tolerant**: when the resolved type's policy
 * forbids `!`, the marker is dropped from the parse (`breaking: false`) and
 * `onPolicyViolation` is invoked. When the policy requires `!`, a bare type triggers the
 * same warning path. The strict write-time gate (commit-msg hook) is out of scope.
 */
export function parseCommitMessage(
  message: string,
  hash: string,
  workTypes: Record<string, WorkTypeConfig>,
  scopeAliases?: Record<string, string>,
  options?: ParseCommitMessageOptions,
): ParsedCommit | undefined {
  // Strip ticket prefixes (e.g., "#8 " or "TOOL-123 ") before matching, and pull off the first line so multi-line
  // messages (subject + body) parse correctly.
  const firstLine = message.split('\n', 1)[0] ?? '';
  const stripped = stripTicketPrefix(firstLine);

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

  const commit: Commit = { message, hash };
  const breaking = evaluateBreakingPolicy({
    commit,
    resolvedType,
    hasPrefixBreaking: breakingMarker === '!',
    hasFooterBreaking: message.includes('BREAKING CHANGE:'),
    policy: options?.breakingPolicies?.[resolvedType] ?? 'optional',
    onPolicyViolation: options?.onPolicyViolation,
  });

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

/** Inputs for {@link evaluateBreakingPolicy}. */
interface BreakingPolicyInputs {
  commit: Commit;
  resolvedType: string;
  hasPrefixBreaking: boolean;
  hasFooterBreaking: boolean;
  policy: 'forbidden' | 'optional' | 'required';
  onPolicyViolation: PolicyViolationHandler | undefined;
}

/**
 * Apply the two-tier `!`-policy rules and return the effective `breaking` flag.
 *
 * Release-time tolerant: violations invoke `onPolicyViolation` and the marker is dropped
 * (`breaking: false`) rather than rejecting the commit. The strict write-time gate lives in
 * the commit-msg hook and is out of scope here.
 */
function evaluateBreakingPolicy(inputs: BreakingPolicyInputs): boolean {
  const { commit, resolvedType, hasPrefixBreaking, hasFooterBreaking, policy, onPolicyViolation } = inputs;
  if (policy === 'forbidden') {
    if (hasPrefixBreaking) {
      onPolicyViolation?.(commit, resolvedType, 'prefix');
    }
    if (hasFooterBreaking) {
      onPolicyViolation?.(commit, resolvedType, 'body');
    }
    return false;
  }
  if (policy === 'required') {
    // Only the prefix `!` carries the breaking signal here; a `BREAKING CHANGE:` body footer
    // is changelog-decoration only and is intentionally not consulted, so a `required`-policy
    // commit without `!` is a single prefix violation regardless of footer content.
    if (!hasPrefixBreaking) {
      onPolicyViolation?.(commit, resolvedType, 'prefix');
      return false;
    }
    return true;
  }
  // 'optional' policy: either form is acceptable.
  return hasPrefixBreaking || hasFooterBreaking;
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
