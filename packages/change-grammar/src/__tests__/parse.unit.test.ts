import { describe, expect, it } from 'vitest';

import { compileTemplate } from '../compile-template.ts';
import { parse } from '../parse.ts';
import { render } from '../render.ts';
import { TEMPLATE_CATALOGUE } from '../templates.ts';
import { normalizeChangeRecord } from '../tokens.ts';
import type { ChangeRecord, Taxonomy } from '../types.ts';

const TAXONOMY: Taxonomy = {
  tiers: ['public', 'internal', 'process'],
  types: [
    { aliases: ['feature'], breakingPolicy: 'optional', key: 'feat', tier: 'public' },
    { aliases: [], breakingPolicy: 'optional', key: 'drop', tier: 'public' },
    { aliases: ['bugfix'], breakingPolicy: 'optional', key: 'fix', tier: 'public' },
    { aliases: ['security'], breakingPolicy: 'optional', key: 'sec', tier: 'public' },
    { aliases: [], breakingPolicy: 'forbidden', key: 'refactor', tier: 'internal' },
    { aliases: ['doc'], breakingPolicy: 'forbidden', key: 'docs', tier: 'process' },
  ],
};

const FLAT_SCOPE_COMMIT = '[{scope}|{type}: ]{title}';
const FLAT_SCOPE_MERGE = '[{ticket_ref} ][{scope}|{type}: ]{title}[ (#{pr_number})]';
const NESTED_SCOPE_COMMIT = TEMPLATE_CATALOGUE.pipedScope;
const NESTED_SCOPE_MERGE = '[{ticket_ref} ][[{scope}|]{type}: ]{title}[ (#{pr_number})]';
const PROJECT_PR = '[{ticket_ref} ]{title}';
const GLOBAL_MERGE = '[{ticket_ref} ][{scope}|][{type}: ]{title}[ (#{pr_number})]';

const ROUND_TRIP_RECORDS: ChangeRecord[] = [
  { scope: 'agents', title: 'Add foo', type: 'feat' },
  { breaking: true, scope: 'agents', title: 'Add foo', type: 'feat' },
  { title: 'Add foo', type: 'fix' },
  { breaking: true, title: 'Add foo', type: 'drop' },
  { scope: 'run-core', title: 'Rename the lane fold', type: 'refactor' },
  { scope: 'agents,kb', title: 'Add the store-qualified wikilink', type: 'feat' },
];

describe(parse, () => {
  describe('inverting a rendered subject', () => {
    const roundTrips = Object.entries(TEMPLATE_CATALOGUE).flatMap(([convention, template]) =>
      ROUND_TRIP_RECORDS.map((record) => ({ convention, record, template })),
    );

    it.each(roundTrips)('inverts $convention for $record', ({ record, template }) => {
      const nodes = compileTemplate(template);

      expect(parse(nodes, render(nodes, record), TAXONOMY)).toStrictEqual(dropScopelessFields(template, record));
    });

    it.each([NESTED_SCOPE_COMMIT, NESTED_SCOPE_MERGE, FLAT_SCOPE_COMMIT, FLAT_SCOPE_MERGE, GLOBAL_MERGE])(
      'inverts the configured template %s',
      (template) => {
        const nodes = compileTemplate(template);
        const record = { prNumber: '470', scope: 'agents', ticketRef: '#466', title: 'Add foo', type: 'feat' };

        expect(parse(nodes, render(nodes, record), TAXONOMY)).toStrictEqual(dropScopelessFields(template, record));
      },
    );

    it('reads a ticket reference and a trailing pull-request number out of a merge subject', () => {
      const record = parse(compileTemplate(FLAT_SCOPE_MERGE), '#466 agents|feat: Add foo (#470)', TAXONOMY);

      expect(record).toStrictEqual({
        prNumber: '470',
        scope: 'agents',
        ticketRef: '#466',
        title: 'Add foo',
        type: 'feat',
      });
    });

    it('reads a Jira-style ticket reference', () => {
      const record = parse(compileTemplate(PROJECT_PR), 'MAC-147 Add foo', TAXONOMY);

      expect(record).toStrictEqual({ ticketRef: 'MAC-147', title: 'Add foo' });
    });

    it('reads a bracketed scope', () => {
      const record = parse(compileTemplate(TEMPLATE_CATALOGUE.bracketedScope), '[agents] feat: Add foo', TAXONOMY);

      expect(record).toStrictEqual({ scope: 'agents', title: 'Add foo', type: 'feat' });
    });

    it('reads the marker off the type when the template names no {breaking}', () => {
      const record = parse(compileTemplate(FLAT_SCOPE_COMMIT), 'agents|feat!: Add foo', TAXONOMY);

      expect(record).toStrictEqual({ breaking: true, scope: 'agents', title: 'Add foo', type: 'feat' });
    });

    it('reads the marker off {breaking} when the template names it', () => {
      const nodes = compileTemplate(TEMPLATE_CATALOGUE.conventionalCommits);

      expect(parse(nodes, 'feat(agents)!: Add foo', TAXONOMY)).toStrictEqual({
        breaking: true,
        scope: 'agents',
        title: 'Add foo',
        type: 'feat',
      });
    });

    it('canonicalizes a declared alias to its key', () => {
      const record = parse(compileTemplate(TEMPLATE_CATALOGUE.typeOnly), 'feature: Add foo', TAXONOMY);

      expect(record?.type).toBe('feat');
    });

    it('resolves a type spelled in another case, as release-kit does', () => {
      const record = parse(compileTemplate(TEMPLATE_CATALOGUE.typeOnly), 'FEAT: Add foo', TAXONOMY);

      expect(record?.type).toBe('feat');
    });

    it('drops the wildcard scope that release-kit keeps, since the engine reads it as no scope', () => {
      const record = parse(compileTemplate(FLAT_SCOPE_COMMIT), '*|feat: Add foo', TAXONOMY);

      expect(record).toStrictEqual({ title: 'Add foo', type: 'feat' });
    });
  });

  describe('unmatched subjects', () => {
    it('refuses a hand-written subject under a template naming {type}', () => {
      expect(parse(compileTemplate(FLAT_SCOPE_COMMIT), 'Add foo', TAXONOMY)).toBeUndefined();
    });

    it('refuses a subject naming a scope but no type', () => {
      expect(parse(compileTemplate(FLAT_SCOPE_COMMIT), 'agents|: Add foo', TAXONOMY)).toBeUndefined();
    });

    it('refuses a subject whose type the taxonomy does not declare', () => {
      expect(parse(compileTemplate(FLAT_SCOPE_COMMIT), 'Support a|b: syntax', TAXONOMY)).toBeUndefined();
    });

    it('refuses a scoped subject under a template that names no scope', () => {
      expect(parse(compileTemplate(TEMPLATE_CATALOGUE.typeOnly), 'feat(agents): Add foo', TAXONOMY)).toBeUndefined();
    });

    it('accepts a bare title under a template naming no {type}', () => {
      expect(parse(compileTemplate(PROJECT_PR), 'Add foo', TAXONOMY)).toStrictEqual({ title: 'Add foo' });
    });
  });

  describe('the ticket-reference preprocessor', () => {
    it('strips a ticket prefix that the template does not name', () => {
      const record = parse(compileTemplate(FLAT_SCOPE_COMMIT), '#466 agents|feat: Add foo', TAXONOMY);

      expect(record).toStrictEqual({ scope: 'agents', title: 'Add foo', type: 'feat' });
    });

    it('strips a sub-ticket prefix that the template does not name', () => {
      const record = parse(compileTemplate(FLAT_SCOPE_COMMIT), '#466.1 agents|feat: Add foo', TAXONOMY);

      expect(record).toStrictEqual({ scope: 'agents', title: 'Add foo', type: 'feat' });
    });

    it('strips a Jira prefix that the template does not name', () => {
      const record = parse(compileTemplate(FLAT_SCOPE_COMMIT), 'MAC-147 agents|feat: Add foo', TAXONOMY);

      expect(record).toStrictEqual({ scope: 'agents', title: 'Add foo', type: 'feat' });
    });

    it('leaves the prefix for the template that names {ticket_ref} to capture', () => {
      const record = parse(compileTemplate(PROJECT_PR), '#466 Add foo', TAXONOMY);

      expect(record).toStrictEqual({ ticketRef: '#466', title: 'Add foo' });
    });
  });

  describe('the ambiguity that the grammar accepts', () => {
    it('reads a pipe-carrying title as a scope and a type, since a present group wins', () => {
      const record = parse(compileTemplate(FLAT_SCOPE_COMMIT), 'Rename kb|docs: the shared layer', TAXONOMY);

      expect(record).toStrictEqual({ scope: 'Rename kb', title: 'the shared layer', type: 'docs' });
    });
  });
});

// region | Helpers

/** Drops the fields that a template names no token for, which a round trip cannot recover. */
function dropScopelessFields(template: string, record: ChangeRecord): ChangeRecord {
  const normalized = normalizeChangeRecord(record);
  const carried: ChangeRecord = {};
  if (template.includes('{scope}') && normalized.scope !== undefined) {
    carried.scope = normalized.scope;
  }
  if (template.includes('{ticket_ref}') && normalized.ticketRef !== undefined) {
    carried.ticketRef = normalized.ticketRef;
  }
  if (template.includes('{pr_number}') && normalized.prNumber !== undefined) {
    carried.prNumber = normalized.prNumber;
  }
  if (normalized.breaking === true) {
    carried.breaking = true;
  }
  if (normalized.title !== undefined) {
    carried.title = normalized.title;
  }
  if (normalized.type !== undefined) {
    carried.type = normalized.type;
  }
  return carried;
}

// endregion | Helpers
