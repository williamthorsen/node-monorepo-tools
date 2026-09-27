import {
  type BreakingPolicy,
  type ChangeRecord,
  compileTemplate,
  parse,
  type Taxonomy,
  TEMPLATE_CATALOGUE,
} from '@williamthorsen/change-grammar';

import type { Commit, ParsedCommit, WorkTypeConfig } from './types.ts';

/** The subject templates that release-kit reads, in the order in which it tries them. */
const SUBJECT_TEMPLATES = [
  compileTemplate(TEMPLATE_CATALOGUE.pipedScope),
  compileTemplate(TEMPLATE_CATALOGUE.conventionalCommits),
];

/**
 * Surface where a breaking-policy violation was detected: a subject's `!`, a `BREAKING CHANGE:` footer, or a
 * change-record entry's `breaking`.
 */
export type PolicyViolationSurface = 'prefix' | 'body' | 'entry';

/**
 * Callback invoked when `parseCommitMessage` detects a `!`-policy violation.
 *
 * The parser warns and continues on a violation, so legacy log entries don't block releases.
 * `readReleaseHistory` collects the invocations for the unreleased window, and the release
 * report lists them.
 */
export type PolicyViolationHandler = (commit: Commit, type: string, surface: PolicyViolationSurface) => void;

/** Optional configuration for `parseCommitMessage` beyond the core inputs. */
export interface ParseCommitMessageOptions {
  /**
   * Per-type breaking-policy lookup keyed by canonical type name. Missing entries are
   * treated as `'optional'` for backward compatibility with consumers that have not
   * supplied policies.
   */
  breakingPolicies?: Record<string, BreakingPolicy>;
  /** Receives policy-violation notifications. See {@link PolicyViolationHandler}. */
  onPolicyViolation?: PolicyViolationHandler;
}

/**
 * Parse a commit message into structured metadata.
 *
 * Reads the first line through change-grammar's `pipedScope` template (`scope|type: description`, the scope optional),
 * then its `conventionalCommits` template (`type(scope): description`), and takes the first match. Types and aliases
 * resolve against `workTypes`, ignoring case; scope aliases resolve when a `scopeAliases` map is provided. Detects
 * breaking changes via the subject's `!` or `BREAKING CHANGE:` in the message.
 *
 * `!`-policy enforcement is **release-time tolerant**: when the resolved type's policy
 * forbids `!`, the marker is dropped from the parse (`breaking: false`) and
 * `onPolicyViolation` is invoked.
 */
export function parseCommitMessage(
  message: string,
  hash: string,
  workTypes: Record<string, WorkTypeConfig>,
  scopeAliases?: Record<string, string>,
  options?: ParseCommitMessageOptions,
): ParsedCommit | undefined {
  const firstLine = message.split('\n', 1)[0] ?? '';
  const record = parseSubject(firstLine, workTypes);
  if (record?.type === undefined || record.title === undefined) {
    return undefined;
  }

  const commit: Commit = { message, subject: firstLine, hash };
  const breaking = evaluateBreakingPolicy({
    commit,
    resolvedType: record.type,
    hasPrefixBreaking: record.breaking === true,
    hasFooterBreaking: message.includes('BREAKING CHANGE:'),
    policy: options?.breakingPolicies?.[record.type] ?? 'optional',
    onPolicyViolation: options?.onPolicyViolation,
  });

  const rawScope = record.scope;
  const resolvedScope =
    rawScope !== undefined && scopeAliases !== undefined ? (scopeAliases[rawScope] ?? rawScope) : rawScope;

  return {
    message,
    hash,
    type: record.type,
    description: record.title,
    breaking,
    ...(resolvedScope !== undefined && { scope: resolvedScope }),
  };
}

/**
 * Reads a commit subject into a change record through the templates that release-kit accepts, before any breaking
 * policy applies. Ticket prefixes are stripped by the engine.
 */
export function parseSubject(subject: string, workTypes: Record<string, WorkTypeConfig>): ChangeRecord | undefined {
  const taxonomy = toTaxonomy(workTypes);
  for (const nodes of SUBJECT_TEMPLATES) {
    const record = parse(nodes, subject, taxonomy);
    if (record !== undefined) {
      return record;
    }
  }
  return undefined;
}

/** Inputs for {@link evaluateBreakingPolicy}. */
export interface BreakingPolicyInputs {
  commit: Commit;
  resolvedType: string;
  /** Whether the marker that `prefixSurface` names is present. */
  hasPrefixBreaking: boolean;
  hasFooterBreaking: boolean;
  policy: BreakingPolicy;
  onPolicyViolation: PolicyViolationHandler | undefined;
  /** The surface reported for a violation of the marker; `'prefix'` when omitted. */
  prefixSurface?: PolicyViolationSurface;
}

/**
 * Applies the `!`-policy rules and returns the effective `breaking` flag.
 *
 * A violation invokes `onPolicyViolation` and drops the marker (`breaking: false`); the
 * commit still parses.
 */
export function evaluateBreakingPolicy(inputs: BreakingPolicyInputs): boolean {
  const { commit, resolvedType, hasPrefixBreaking, hasFooterBreaking, policy, onPolicyViolation } = inputs;
  const prefixSurface = inputs.prefixSurface ?? 'prefix';
  if (policy === 'forbidden') {
    if (hasPrefixBreaking) {
      onPolicyViolation?.(commit, resolvedType, prefixSurface);
    }
    if (hasFooterBreaking) {
      onPolicyViolation?.(commit, resolvedType, 'body');
    }
    return false;
  }
  // 'optional' policy: either form is acceptable.
  return hasPrefixBreaking || hasFooterBreaking;
}

/**
 * Resolves a raw type string to its canonical type name using the record keys and aliases.
 */
export function resolveType(rawType: string, workTypes: Record<string, WorkTypeConfig>): string | undefined {
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

// region | Helpers

/** Adapts configured work types to the engine's taxonomy; `parse` reads only keys and aliases, so the tier is empty. */
function toTaxonomy(workTypes: Record<string, WorkTypeConfig>): Taxonomy {
  return {
    tiers: [],
    types: Object.entries(workTypes).map(([key, config]) => ({ aliases: config.aliases ?? [], key, tier: '' })),
  };
}

// endregion | Helpers
