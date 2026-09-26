import { isTokenName, type TokenName } from './tokens.ts';

/**
 * Compiles a template string into the node tree that `render` and `parse` both walk. One tree serving both directions
 * makes them inverses of each other rather than two implementations kept in step by hand.
 *
 * `[` opens an optional group and `]` closes it; groups nest. A backslash escapes `[`, `]`, or another backslash into
 * literal text. A `{...}` run naming a declared token compiles to a token node; any other `{...}` run stays literal, so
 * a misspelled token shows up in rendered output rather than vanishing.
 *
 * Throws when the brackets do not balance, naming the template and the defect.
 */
export function compileTemplate(template: string): TemplateNode[] {
  const { index, nodes } = compileNodes(template, 0, false);
  if (index < template.length) {
    throw new Error(`Unmatched "]" in template ${JSON.stringify(template)}.`);
  }
  return nodes;
}

/** An optional group: It renders only when every token directly inside it resolves non-empty. */
export interface GroupNode {
  children: TemplateNode[];
  kind: 'group';
}

/** A run of text rendered verbatim. */
export interface LiteralNode {
  kind: 'literal';
  text: string;
}

/** One node of a compiled template. */
export type TemplateNode = GroupNode | LiteralNode | TokenNode;

/** A reference to a declared token, replaced by the record value that it names. */
export interface TokenNode {
  kind: 'token';
  name: TokenName;
}

// region | Helpers

/**
 * Compiles the nodes from `start` until the template ends or, inside a group, until the group's `]`. Reports the index
 * of the character that stopped it, which is how the caller tells a closed group from an unclosed one.
 */
function compileNodes(template: string, start: number, insideGroup: boolean): CompiledRun {
  const nodes: TemplateNode[] = [];
  let literal = '';
  let index = start;

  function flushLiteral(): void {
    if (literal === '') {
      return;
    }
    nodes.push({ kind: 'literal', text: literal });
    literal = '';
  }

  while (index < template.length) {
    const char = template[index] ?? '';
    const escaped = char === '\\' ? (template[index + 1] ?? '') : '';

    if (ESCAPABLE_CHARACTERS.has(escaped)) {
      literal += escaped;
      index += 2;
      continue;
    }

    if (char === '[') {
      flushLiteral();
      const group = compileNodes(template, index + 1, true);
      if (group.index >= template.length) {
        throw new Error(`Unclosed "[" group in template ${JSON.stringify(template)}.`);
      }
      nodes.push({ children: group.nodes, kind: 'group' });
      index = group.index + 1;
      continue;
    }

    if (char === ']') {
      if (insideGroup) {
        break;
      }
      flushLiteral();
      return { index, nodes };
    }

    const token = readTokenAt(template, index);
    if (token === undefined) {
      literal += char;
      index += 1;
      continue;
    }
    flushLiteral();
    nodes.push({ kind: 'token', name: token.name });
    index = token.index;
  }

  flushLiteral();
  return { index, nodes };
}

/** The characters that a backslash turns into literal text. */
const ESCAPABLE_CHARACTERS = new Set(['[', ']', '\\']);

/**
 * Reads a token reference beginning at `index`, reporting the name and the index just past the closing brace. Yields
 * nothing when the run is not a `{...}` naming a declared token.
 */
function readTokenAt(template: string, index: number): { index: number; name: TokenName } | undefined {
  if (template[index] !== '{') {
    return undefined;
  }
  const close = template.indexOf('}', index + 1);
  if (close === -1) {
    return undefined;
  }
  const name = template.slice(index + 1, close);
  return isTokenName(name) ? { index: close + 1, name } : undefined;
}

/** The nodes produced by one `compileNodes` pass, and the index at which it stopped. */
interface CompiledRun {
  index: number;
  nodes: TemplateNode[];
}

// endregion | Helpers
