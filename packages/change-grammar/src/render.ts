import type { TemplateNode } from './compile-template.ts';
import { BREAKING_MARKER, normalizeChangeRecord, type TokenName } from './tokens.ts';
import type { ChangeRecord } from './types.ts';

/**
 * Renders compiled template nodes against a record, producing the surface string.
 *
 * A group drops, literals included, when a token directly inside it resolves empty. Each nested group drops or renders
 * on its own, so `[[{scope}|]{type}: ]` keeps the type prefix for a change that names no scope. `{breaking}` never
 * decides a group, since a non-breaking change would otherwise drop the prefix that contains it.
 *
 * When the template names no `{breaking}`, `{type}` appends the marker itself and renders `feat!`, which is how a
 * convention that places the marker on the type stays renderable.
 *
 * Output is exactly what the nodes describe: Because no whitespace pass runs, `parse` inverts what `render` produced.
 */
export function render(nodes: readonly TemplateNode[], record: ChangeRecord): string {
  const normalized = normalizeChangeRecord(record);
  return renderNodes(nodes, normalized, namesBreakingToken(nodes));
}

// region | Helpers

/** Reports whether a token directly inside `nodes`, `{breaking}` excepted, resolves empty. */
function hasEmptyDirectToken(nodes: readonly TemplateNode[], record: ChangeRecord, marksBreaking: boolean): boolean {
  return nodes.some(
    (node) =>
      node.kind === 'token' && node.name !== 'breaking' && resolveToken(record, node.name, marksBreaking) === '',
  );
}

/** Reports whether the template names `{breaking}` anywhere, at any depth. */
function namesBreakingToken(nodes: readonly TemplateNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'token') {
      return node.name === 'breaking';
    }
    return node.kind === 'group' && namesBreakingToken(node.children);
  });
}

/** Walks one run of nodes, dropping each group whose direct tokens are not all populated. */
function renderNodes(nodes: readonly TemplateNode[], record: ChangeRecord, marksBreaking: boolean): string {
  let rendered = '';
  for (const node of nodes) {
    if (node.kind === 'literal') {
      rendered += node.text;
    } else if (node.kind === 'token') {
      rendered += resolveToken(record, node.name, marksBreaking);
    } else if (!hasEmptyDirectToken(node.children, record, marksBreaking)) {
      rendered += renderNodes(node.children, record, marksBreaking);
    }
  }
  return rendered;
}

/** Resolves one token against the record, empty when the record omits the field that it names. */
function resolveToken(record: ChangeRecord, name: TokenName, marksBreaking: boolean): string {
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
      return resolveTypeToken(record, marksBreaking);
  }
}

/** Resolves `{type}`, appending the marker when the template names no `{breaking}` to render it. */
function resolveTypeToken(record: ChangeRecord, marksBreaking: boolean): string {
  if (record.type === undefined) {
    return '';
  }
  return !marksBreaking && record.breaking === true ? `${record.type}${BREAKING_MARKER}` : record.type;
}

// endregion | Helpers
