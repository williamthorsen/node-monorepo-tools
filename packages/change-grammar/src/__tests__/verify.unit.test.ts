import { describe, expect, it } from 'vitest';

import { TEMPLATE_CATALOGUE } from '../templates.ts';
import type { Taxonomy } from '../types.ts';
import { findLossyRenders, verify } from '../verify.ts';

const TAXONOMY: Taxonomy = {
  tiers: ['public', 'internal', 'process'],
  types: [
    { aliases: ['feature'], breakingPolicy: 'optional', key: 'feat', tier: 'public' },
    { aliases: ['bugfix'], breakingPolicy: 'optional', key: 'fix', tier: 'public' },
    { aliases: ['doc'], breakingPolicy: 'forbidden', key: 'docs', tier: 'process' },
  ],
};

describe(findLossyRenders, () => {
  it.each(Object.entries(TEMPLATE_CATALOGUE))('does not warn on the %s convention', (_convention, template) => {
    expect(findLossyRenders(template, TAXONOMY)).toStrictEqual([]);
  });

  it.each([
    '{title}',
    'Release',
    '[{ticket_ref} ]{title}',
    '[{ticket_ref} ][[{scope}|]{type}: ]{title}[ (#{pr_number})]',
    '[{ticket_ref} ][{scope}|][{type}: ]{title}[ (#{pr_number})]',
  ])('does not warn on the configured template %s', (template) => {
    expect(findLossyRenders(template, TAXONOMY)).toStrictEqual([]);
  });

  it('warns where a scope group containing the type drops the type with an absent scope', () => {
    expect(findLossyRenders('[{scope}|{type}: ]{title}', TAXONOMY)).toStrictEqual([
      'Template "[{scope}|{type}: ]{title}" renders a record without {scope} as "Add foo", which reads back as unmatched.',
      'Template "[{scope}|{type}: ]{title}" renders a breaking record without {scope} as "Add foo", which reads back as unmatched.',
    ]);
  });

  it('names each combination of absent tokens that loses the type', () => {
    const warnings = findLossyRenders('[{ticket_ref} ][{scope}|{type}: ]{title}[ (#{pr_number})]', TAXONOMY);

    expect(warnings).toHaveLength(8);
    expect(warnings.every((warning) => /without .*\{scope\}/.test(warning))).toBe(true);
    expect(warnings.some((warning) => warning.includes('without {ticket_ref} or {scope} or {pr_number}'))).toBe(true);
  });

  it('warns where a group that can drop contains the breaking marker', () => {
    expect(findLossyRenders('{type}[({scope}){breaking}]: {title}', TAXONOMY)).toStrictEqual([
      'Template "{type}[({scope}){breaking}]: {title}" renders a breaking record without {scope} as "feat: Add foo", which reads back as [["title","Add foo"],["type","feat"]].',
    ]);
  });

  it('does not warn on a template that does not compile, which verify refuses', () => {
    expect(findLossyRenders('[{scope}|{type}: {title}', TAXONOMY)).toStrictEqual([]);
  });
});

describe(verify, () => {
  describe('templates that it accepts', () => {
    it.each(Object.entries(TEMPLATE_CATALOGUE))('accepts the %s convention', (_convention, template) => {
      expect(verify(template, TAXONOMY)).toStrictEqual([]);
    });

    it.each([
      '{title}',
      '[[{scope}|]{type}: ]{title}',
      '[{scope}|{type}: ]{title}',
      '[{ticket_ref} ]{title}',
      '[{ticket_ref} ][[{scope}|]{type}: ]{title}[ (#{pr_number})]',
      '[{ticket_ref} ][{scope}|{type}: ]{title}[ (#{pr_number})]',
      '[{ticket_ref} ][{scope}|][{type}: ]{title}[ (#{pr_number})]',
    ])('accepts the configured template %s', (template) => {
      expect(verify(template, TAXONOMY)).toStrictEqual([]);
    });

    it('accepts a template whose ambiguity depends on the values, since #1638 inverts it', () => {
      expect(verify('[{ticket_ref} ]{title}', TAXONOMY)).toStrictEqual([]);
    });

    it('accepts a template whose scope group contains the type, whose drop leaves nothing to read back', () => {
      expect(verify('[{scope}|{type}: ]{title}', TAXONOMY)).toStrictEqual([]);
    });
  });

  describe('structural defects', () => {
    it('refuses two adjacent tokens, naming the template and the pair', () => {
      const defects = verify('{scope}{type}: {title}', TAXONOMY);

      expect(defects).toContain(
        'Template "{scope}{type}: {title}" places {scope} and {type} without a literal between them.',
      );
    });

    it('refuses a repeated token, naming the template and the token', () => {
      const defects = verify('{title}: {title}', TAXONOMY);

      expect(defects).toContain('Template "{title}: {title}" names {title} more than once.');
    });

    it('refuses an optional group whose opening literal repeats the text before it', () => {
      const defects = verify('{title} [ (#{pr_number})]', TAXONOMY);

      expect(defects.some((defect) => defect.includes('repeating the text before it'))).toBe(true);
    });

    it('refuses {breaking} beside free text, where the marker is not distinguishable', () => {
      const defects = verify('{type}: {title}{breaking}', TAXONOMY);

      expect(defects).toContain(
        'Template "{type}: {title}{breaking}" places {breaking} where "!" is not distinguishable from its neighbour.',
      );
    });

    it('refuses {breaking} beside a literal that spells the marker', () => {
      const defects = verify('{type}!{breaking}: {title}', TAXONOMY);

      expect(defects.some((defect) => defect.includes('not distinguishable'))).toBe(true);
    });

    it('refuses a template whose brackets do not balance', () => {
      expect(verify('[{scope}|{type}: {title}', TAXONOMY)).toStrictEqual([
        'Unclosed "[" group in template "[{scope}|{type}: {title}".',
      ]);
    });

    it('keeps {type}{breaking} out of the adjacency rule, since three conventions place them together', () => {
      expect(verify('{type}{breaking}: {title}', TAXONOMY)).toStrictEqual([]);
    });
  });

  describe('the round-trip check', () => {
    it('refuses a template that renders a value which it cannot read back', () => {
      const defects = verify('{title} {scope}', TAXONOMY);

      expect(defects.some((defect) => defect.includes('does not round-trip'))).toBe(true);
    });

    it('refuses a template whose optional group cannot be told from an absent one', () => {
      const defects = verify('[{scope} ]{title}', TAXONOMY);

      expect(defects.some((defect) => defect.includes('does not round-trip'))).toBe(true);
    });

    it('refuses a template whose scope delimiter is the comma that joins a scope list', () => {
      const defects = verify('[{scope},]{type}: {title}', TAXONOMY);

      expect(defects.some((defect) => defect.includes('does not round-trip'))).toBe(true);
    });

    it('accepts a template that does not name any token', () => {
      expect(verify('Release', TAXONOMY)).toStrictEqual([]);
    });
  });
});
