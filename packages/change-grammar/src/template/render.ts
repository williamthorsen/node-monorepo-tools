import { BREAKING_MARKER, normalizeChangeRecord, type TokenName } from '../record/tokens.ts';
import type { ChangeRecord } from '../record/types.ts';
import { namesToken, type TemplateNode } from './compile-template.ts';

/**
 * Renders compiled template nodes against a record, producing the surface string.
 *
 * A group drops, literals included, when a token directly inside it resolves empty. Each nested group drops or renders
 * on its own, so `[[{scope}|]{type}: ]` keeps the type prefix for a change that does not name a scope. `{breaking}`
 * never decides a group, since a non-breaking change would otherwise drop the prefix that contains it.
 *
 * When the template does not name `{breaking}`, `{type}` appends the marker itself and renders `feat!`, which is how a
 * convention that places the marker on the type stays renderable.
 *
 * Because output is exactly what the nodes describe, whitespace included, `parse` inverts it.
 */
export function render(nodes: readonly TemplateNode[], record: ChangeRecord): string {
  const normalized = normalizeChangeRecord(record);
  return renderNodes(nodes, normalized, namesToken(nodes, 'breaking'));
}

// region | Helpers

/** Reports whether a token directly inside `nodes`, `{breaking}` excepted, resolves empty. */
function hasEmptyDirectToken(nodes: readonly TemplateNode[], record: ChangeRecord, doesNameBreaking: boolean): boolean {
  return nodes.some(
    (node) =>
      node.kind === 'token' && node.name !== 'breaking' && resolveToken(record, node.name, doesNameBreaking) === '',
  );
}

/** Walks one run of nodes, dropping each group that has an empty direct token other than `{breaking}`. */
function renderNodes(nodes: readonly TemplateNode[], record: ChangeRecord, doesNameBreaking: boolean): string {
  let rendered = '';
  for (const node of nodes) {
    if (node.kind === 'literal') {
      rendered += node.text;
    } else if (node.kind === 'token') {
      rendered += resolveToken(record, node.name, doesNameBreaking);
    } else if (!hasEmptyDirectToken(node.children, record, doesNameBreaking)) {
      rendered += renderNodes(node.children, record, doesNameBreaking);
    }
  }
  return rendered;
}

/** Resolves one token against the record, empty when the record omits the field that it names. */
function resolveToken(record: ChangeRecord, name: TokenName, doesNameBreaking: boolean): string {
  switch (name) {
    case 'breaking':
      return record.breaking === true ? BREAKING_MARKER : '';
    case 'pr_number':
      return record.prNumber ?? '';
    case 'scope':
      return record.scope ?? '';
    case 'ticket_ref':
      return record.ticketRef ?? '';
    case 'title':
      return record.title ?? '';
    case 'type':
      return resolveTypeToken(record, doesNameBreaking);
  }
}

/** Resolves `{type}`, appending the marker when the template does not name `{breaking}` to render it. */
function resolveTypeToken(record: ChangeRecord, doesNameBreaking: boolean): string {
  if (record.type === undefined) {
    return '';
  }
  return !doesNameBreaking && record.breaking === true ? `${record.type}${BREAKING_MARKER}` : record.type;
}

// endregion | Helpers
