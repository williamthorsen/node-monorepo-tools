import type { TemplateNode, TokenNode } from './compile-template.ts';
import { BREAKING_MARKER, normalizeChangeRecord, type TokenName } from './tokens.ts';
import type { ChangeRecord, Taxonomy } from './types.ts';

/**
 * Inverts a template: reads a rendered surface string back into the record that produced it, or reports the string as
 * unmatched. It compiles the same node tree that `render` walks, so the two stay inverses of each other.
 *
 * Every token compiles to a constrained sub-pattern, which makes the inversion decidable: `{type}` an alternation over
 * the taxonomy's keys and aliases, `{ticket_ref}` a `#123` or `ABC-123` reference, `{pr_number}` digits, `{breaking}`
 * the marker, `{scope}` a run bounded by the delimiter that the template itself places after it, and `{title}` a lazy
 * run so that a trailing group wins the tail of the string.
 *
 * When an optional group could be read as present or absent, present wins, which is release-kit's reading. That reading
 * misparses a plain title that contains a pipe and a declared type: Under `[[{scope}|]{type}: ]{title}`, `Rename kb|docs: the shared
 * layer` parses as scope `Rename kb`, type `docs`, title `the shared layer`.
 *
 * A template naming `{type}` requires one: A subject that names a scope but no declared type is unmatched. A template
 * naming no `{ticket_ref}` has release-kit's three ticket-prefix forms stripped from the subject first.
 */
export function parse(nodes: readonly TemplateNode[], subject: string, taxonomy: Taxonomy): ChangeRecord | undefined {
  const options: PatternOptions = {
    delimiters: mapScopeDelimiters(nodes),
    namesBreaking: namesToken(nodes, 'breaking'),
    typeAlternation: buildTypeAlternation(taxonomy),
  };
  const namesType = namesToken(nodes, 'type');
  const prepared = namesToken(nodes, 'ticket_ref') ? subject : stripTicketPrefix(subject);

  const match = new RegExp(`^${buildPattern(nodes, options)}$`).exec(prepared);
  if (match === null) {
    return undefined;
  }

  const groups: Partial<Record<string, string>> = match.groups ?? {};
  const record: ChangeRecord = {};
  if (groups['breaking'] === BREAKING_MARKER) {
    record.breaking = true;
  }
  for (const [token, field] of CAPTURED_FIELDS) {
    const value = groups[token];
    if (value !== undefined) {
      record[field] = value;
    }
  }
  if (groups['type'] !== undefined) {
    const canonical = canonicalizeType(groups['type'], taxonomy);
    if (canonical === undefined) {
      return undefined;
    }
    record.type = canonical;
  }

  return namesType && record.type === undefined ? undefined : normalizeChangeRecord(record);
}

/** The ticket-reference forms stripped from a subject whose template names no `{ticket_ref}`. */
export const TICKET_PREFIX_PATTERNS: readonly RegExp[] = [/^##\s+/, /^#\d+([.-]\d+)?\s+/, /^[A-Z]+-\d+\s+/];

// region | Helpers

/** Compiles the nodes to a regular-expression source, each optional group greedy so that a present reading wins. */
function buildPattern(nodes: readonly TemplateNode[], options: PatternOptions): string {
  let pattern = '';
  for (const node of nodes) {
    if (node.kind === 'literal') {
      pattern += escapeForPattern(node.text);
    } else if (node.kind === 'group') {
      pattern += `(?:${buildPattern(node.children, options)})?`;
    } else {
      pattern += buildTokenPattern(node, options);
    }
  }
  return pattern;
}

/** Compiles one token to the constrained sub-pattern that makes it recognizable inside a rendered string. */
function buildTokenPattern(node: TokenNode, options: PatternOptions): string {
  switch (node.name) {
    case 'breaking':
      return `(?<breaking>${escapeForPattern(BREAKING_MARKER)})?`;
    case 'pr_number':
      return String.raw`(?<pr_number>\d+)`;
    case 'scope': {
      const delimiter = options.delimiters.get(node);
      return delimiter === undefined ? '(?<scope>.+?)' : `(?<scope>[^${escapeForCharacterClass(delimiter)}]+)`;
    }
    case 'ticket_ref':
      return String.raw`(?<ticket_ref>#\d+|[A-Z]{2,}-\d+)`;
    case 'title':
      return '(?<title>.+?)';
    case 'type':
      // When the template names no `{breaking}`, the marker follows the type, exactly as `render` writes it.
      return options.namesBreaking
        ? `(?<type>${options.typeAlternation})`
        : `(?<type>${options.typeAlternation})(?<breaking>${escapeForPattern(BREAKING_MARKER)})?`;
  }
}

/**
 * Builds the alternation of every spelling declared by the taxonomy, longest first so that `feature` outranks `feat`.
 */
function buildTypeAlternation(taxonomy: Taxonomy): string {
  return [...collectSpellings(taxonomy)]
    .toSorted((a, b) => b.length - a.length || a.localeCompare(b))
    .map(toEitherCaseSource)
    .join('|');
}

/** Resolves a spelled type to its canonical key, ignoring case as release-kit's parser does. */
function canonicalizeType(spelling: string, taxonomy: Taxonomy): string | undefined {
  const lowered = spelling.toLowerCase();
  for (const entry of taxonomy.types) {
    if (entry.key.toLowerCase() === lowered) {
      return entry.key;
    }
    if ((entry.aliases ?? []).some((alias) => alias.toLowerCase() === lowered)) {
      return entry.key;
    }
  }
  return undefined;
}

/** The record field written by each capturing token, `{type}` and `{breaking}` excepted; both need resolution first. */
const CAPTURED_FIELDS: ReadonlyArray<[string, 'prNumber' | 'scope' | 'ticketRef' | 'title']> = [
  ['pr_number', 'prNumber'],
  ['scope', 'scope'],
  ['ticket_ref', 'ticketRef'],
  ['title', 'title'],
];

/** Gathers every key and alias that the taxonomy declares. */
function collectSpellings(taxonomy: Taxonomy): Set<string> {
  const spellings = new Set<string>();
  for (const entry of taxonomy.types) {
    spellings.add(entry.key);
    const aliases = entry.aliases ?? [];
    for (const alias of aliases) {
      spellings.add(alias);
    }
  }
  return spellings;
}

/** Escapes a character for use inside a negated character class. */
function escapeForCharacterClass(char: string): string {
  return /[\]\\^-]/.test(char) ? `\\${char}` : char;
}

/** Escapes literal text so that it matches itself rather than acting as pattern syntax. */
function escapeForPattern(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Collects the nodes in document order, a group's children standing in for the group. */
function flatten(nodes: readonly TemplateNode[], into: TemplateNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'group') {
      flatten(node.children, into);
    } else {
      into.push(node);
    }
  }
}

/**
 * Records, for each `{scope}` token, the first character of the next literal text in document order. That character is
 * the delimiter that the template itself places after the scope, and bounding the scope by it keeps a scope containing
 * spaces or a `*` from matching the rest of the subject.
 */
function mapScopeDelimiters(nodes: readonly TemplateNode[]): ReadonlyMap<TokenNode, string> {
  const flattened: TemplateNode[] = [];
  flatten(nodes, flattened);

  const delimiters = new Map<TokenNode, string>();
  for (const [index, node] of flattened.entries()) {
    if (node.kind !== 'token' || node.name !== 'scope') {
      continue;
    }
    const following = flattened.slice(index + 1).find((next) => next.kind === 'literal' && next.text !== '');
    if (following?.kind === 'literal') {
      delimiters.set(node, following.text.slice(0, 1));
    }
  }
  return delimiters;
}

/** Reports whether the template names `token` anywhere, at any depth. */
function namesToken(nodes: readonly TemplateNode[], token: TokenName): boolean {
  return nodes.some((node) => {
    if (node.kind === 'token') {
      return node.name === token;
    }
    return node.kind === 'group' && namesToken(node.children, token);
  });
}

/** What pattern construction needs beyond the nodes themselves. */
interface PatternOptions {
  delimiters: ReadonlyMap<TokenNode, string>;
  namesBreaking: boolean;
  typeAlternation: string;
}

/** Removes the ticket-reference forms that release-kit strips before reading a subject. */
function stripTicketPrefix(subject: string): string {
  let stripped = subject;
  for (const pattern of TICKET_PREFIX_PATTERNS) {
    stripped = stripped.replace(pattern, '');
  }
  return stripped;
}

/** Renders a spelling as a source matching it in either case, leaving the rest of the pattern case-sensitive. */
function toEitherCaseSource(spelling: string): string {
  return spelling.replaceAll(/./gs, (char) => {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    return lower === upper ? escapeForPattern(char) : `[${lower}${upper}]`;
  });
}

// endregion | Helpers
