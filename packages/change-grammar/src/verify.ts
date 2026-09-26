import { compileTemplate, type GroupNode, type TemplateNode } from './compile-template.ts';
import { parse } from './parse.ts';
import { render } from './render.ts';
import type { TokenName } from './tokens.ts';
import type { ChangeRecord, Taxonomy } from './types.ts';

/**
 * Reports every reason a template cannot round-trip, empty when it can. A caller refuses the template on a non-empty
 * result; each message names the template and the defect, so the refusal says what to change.
 *
 * The structural rules run first and hold whatever the values are. Render-and-parse passes over well-formed values then
 * backstop them, because a later grammar extension could otherwise outrun the checker silently.
 *
 * Value-dependent ambiguity is not a defect. Under `[{ticket_ref} ]{title}` a title opening with `#466 ` is
 * indistinguishable from a ticket reference, as it is for release-kit, and the template is accepted.
 */
export function verify(template: string, taxonomy: Taxonomy): string[] {
  let nodes: TemplateNode[];
  try {
    nodes = compileTemplate(template);
  } catch (error) {
    // eslint-disable-next-line no-restricted-syntax -- The package depends on no package, so neither suggested helper is in reach.
    return [error instanceof Error ? error.message : `Template ${JSON.stringify(template)} could not be compiled.`];
  }

  const flattened = flattenTemplate(nodes);
  const defects = [
    ...findAdjacentTokenDefects(template, flattened),
    ...findRepeatedTokenDefects(template, flattened),
    ...findGroupBoundaryDefects(template, nodes),
    ...findBreakingMarkerDefects(template, flattened),
  ];
  return defects.length > 0 ? defects : findRoundTripDefects(template, nodes, flattened, taxonomy);
}

// region | Helpers

/** Reports whether a neighbouring node could itself supply the `!` at the edge that faces `{breaking}`. */
function admitsMarker(node: FlatNode | undefined, edge: 'end' | 'start'): boolean {
  if (node === undefined) {
    return false;
  }
  if (node.kind === 'literal') {
    return (edge === 'end' ? node.text.at(-1) : node.text.at(0)) === '!';
  }
  return FREE_TEXT_TOKENS.has(node.name);
}

/** Builds a well-formed record containing exactly the tokens that `present` names. */
function buildSample(present: ReadonlySet<TokenName>, breaking: boolean, taxonomy: Taxonomy): ChangeRecord {
  const sample: ChangeRecord = {};
  if (breaking) {
    sample.breaking = true;
  }
  if (present.has('pr_number')) {
    sample.prNumber = SAMPLE_PR_NUMBER;
  }
  if (present.has('scope')) {
    sample.scope = SAMPLE_SCOPE;
  }
  if (present.has('ticket_ref')) {
    sample.ticketRef = SAMPLE_TICKET_REF;
  }
  if (present.has('title')) {
    sample.title = SAMPLE_TITLE;
  }
  const type = taxonomy.types.at(0)?.key;
  if (present.has('type') && type !== undefined) {
    sample.type = type;
  }
  return sample;
}

/** Serializes a record with its keys ordered, so that two equal records compare equal as text. */
function describeRecord(record: ChangeRecord | undefined): string {
  if (record === undefined) {
    return 'unmatched';
  }
  return JSON.stringify(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));
}

/** Reports two tokens with no literal between them, which a parse cannot split. `{breaking}` has its own rule. */
function findAdjacentTokenDefects(template: string, flattened: readonly FlatNode[]): string[] {
  const defects: string[] = [];
  for (const [index, node] of flattened.entries()) {
    const next = flattened[index + 1];
    if (node.kind !== 'token' || next?.kind !== 'token' || node.name === 'breaking' || next.name === 'breaking') {
      continue;
    }
    defects.push(
      `Template ${JSON.stringify(template)} places {${node.name}} and {${next.name}} with no literal between them.`,
    );
  }
  return defects;
}

/**
 * Reports `{breaking}` placed where the marker cannot be told from its neighbours: beside free text that may itself
 * contain a `!`, or beside a literal that spells one.
 */
function findBreakingMarkerDefects(template: string, flattened: readonly FlatNode[]): string[] {
  const defects: string[] = [];
  for (const [index, node] of flattened.entries()) {
    if (node.kind !== 'token' || node.name !== 'breaking') {
      continue;
    }
    if (admitsMarker(flattened[index - 1], 'end') || admitsMarker(flattened[index + 1], 'start')) {
      defects.push(
        `Template ${JSON.stringify(template)} places {${node.name}} where "!" is not distinguishable from its neighbour.`,
      );
    }
  }
  return defects;
}

/** Reports an optional group whose opening literal repeats the text before it, hiding where the group begins. */
function findGroupBoundaryDefects(template: string, nodes: readonly TemplateNode[]): string[] {
  const defects: string[] = [];
  let previousLiteral: string | undefined;

  function walk(list: readonly TemplateNode[]): void {
    for (const node of list) {
      if (node.kind === 'literal') {
        previousLiteral = node.text;
        continue;
      }
      if (node.kind === 'token') {
        previousLiteral = undefined;
        continue;
      }
      const leading = readLeadingLiteral(node);
      if (previousLiteral !== undefined && leading !== undefined && previousLiteral.at(-1) === leading.at(0)) {
        defects.push(
          `Template ${JSON.stringify(template)} opens an optional group with ${JSON.stringify(leading)}, repeating the text before it.`,
        );
      }
      walk(node.children);
    }
  }

  walk(nodes);
  return defects;
}

/** Reports a token named more than once, which leaves a parse no way to decide which occurrence a value belongs to. */
function findRepeatedTokenDefects(template: string, flattened: readonly FlatNode[]): string[] {
  const counts = new Map<TokenName, number>();
  for (const node of flattened) {
    if (node.kind === 'token') {
      counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([name]) => `Template ${JSON.stringify(template)} names {${name}} more than once.`);
}

/**
 * Renders well-formed values and reads them back, so that a defect that no structural rule names is still reported. One
 * pass includes every token named by the template; one further pass per optional group drops that group, since a group
 * that a parse cannot tell from an absent one is the ordinary case for which a group exists.
 *
 * A group containing `{type}` is left populated. Dropping it takes the type out of the rendered string, which the
 * type-required rule then reads as unmatched however well-formed the template is.
 *
 * A group containing `{breaking}` is left populated too, for a reason of its own: The sample takes the marker from the
 * pass rather than from the tokens that it names, so a pass that dropped such a group would still expect a marker back
 * from a string that no longer contains one.
 */
function findRoundTripDefects(
  template: string,
  nodes: readonly TemplateNode[],
  flattened: readonly FlatNode[],
  taxonomy: Taxonomy,
): string[] {
  const named = new Set(flattened.filter((node) => node.kind === 'token').map((node) => node.name));
  const carriesMarker = named.has('breaking') || named.has('type');
  const markerStates = carriesMarker ? [false, true] : [false];

  const passes: Array<ReadonlySet<TokenName>> = [named];
  for (const vanishing of mapDroppableTokens(nodes).values()) {
    if (!vanishing.has('breaking') && !vanishing.has('type')) {
      passes.push(named.difference(vanishing));
    }
  }

  const defects: string[] = [];
  for (const breaking of markerStates) {
    for (const present of passes) {
      const sample = buildSample(present, breaking, taxonomy);
      const rendered = render(nodes, sample);
      const parsed = parse(nodes, rendered, taxonomy);
      if (describeRecord(parsed) !== describeRecord(sample)) {
        defects.push(
          `Template ${JSON.stringify(template)} does not round-trip: it renders ${describeRecord(sample)} as ${JSON.stringify(rendered)}, which reads back as ${describeRecord(parsed)}.`,
        );
      }
    }
  }
  return defects;
}

/** A template node with the groups flattened away. */
type FlatNode = Exclude<TemplateNode, GroupNode>;

/** Flattens the tree to document order, a group's children standing in for the group. */
function flattenTemplate(nodes: readonly TemplateNode[]): FlatNode[] {
  const flattened: FlatNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'group') {
      flattened.push(...flattenTemplate(node.children));
    } else {
      flattened.push(node);
    }
  }
  return flattened;
}

/** The tokens whose values are free text, so either edge of one may spell the breaking marker. */
const FREE_TEXT_TOKENS: ReadonlySet<TokenName> = new Set<TokenName>(['scope', 'title']);

/** Maps each token that an optional group can drop to every token that vanishes when that group drops. */
function mapDroppableTokens(nodes: readonly TemplateNode[]): Map<TokenName, ReadonlySet<TokenName>> {
  const droppable = new Map<TokenName, ReadonlySet<TokenName>>();

  function walk(list: readonly TemplateNode[]): void {
    for (const node of list) {
      if (node.kind !== 'group') {
        continue;
      }
      const vanishing = new Set(
        flattenTemplate(node.children)
          .filter((child) => child.kind === 'token')
          .map((child) => child.name),
      );
      for (const child of node.children) {
        if (child.kind === 'token' && child.name !== 'breaking') {
          droppable.set(child.name, vanishing);
        }
      }
      walk(node.children);
    }
  }

  walk(nodes);
  return droppable;
}

/** The group's own opening literal, if it opens with one. */
function readLeadingLiteral(group: GroupNode): string | undefined {
  const first = group.children.at(0);
  if (first?.kind === 'literal') {
    return first.text;
  }
  return first?.kind === 'group' ? readLeadingLiteral(first) : undefined;
}

const SAMPLE_PR_NUMBER = '470';
const SAMPLE_SCOPE = 'agents,kb';
const SAMPLE_TICKET_REF = '#466';
const SAMPLE_TITLE = 'Add foo';

// endregion | Helpers
