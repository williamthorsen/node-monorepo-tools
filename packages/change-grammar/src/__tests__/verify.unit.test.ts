import { describe, expect, it } from 'vitest';

import { TEMPLATE_CATALOGUE } from '../templates.ts';
import type { Taxonomy } from '../types.ts';
import { verify } from '../verify.ts';

const TAXONOMY: Taxonomy = {
  tiers: ['public', 'internal', 'process'],
  types: [
    { aliases: ['feature'], breakingPolicy: 'optional', key: 'feat', tier: 'public' },
    { aliases: ['bugfix'], breakingPolicy: 'optional', key: 'fix', tier: 'public' },
    { aliases: ['doc'], breakingPolicy: 'forbidden', key: 'docs', tier: 'process' },
  ],
};

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
        'Template "{scope}{type}: {title}" places {scope} and {type} with no literal between them.',
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

  describe('the round-trip backstop', () => {
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

    it('accepts a template that names no token at all', () => {
      expect(verify('Release', TAXONOMY)).toStrictEqual([]);
    });
  });
});
