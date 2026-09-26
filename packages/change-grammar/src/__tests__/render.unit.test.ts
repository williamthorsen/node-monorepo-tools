import { describe, expect, it } from 'vitest';

import { compileTemplate } from '../compile-template.ts';
import { render } from '../render.ts';
import { type ConventionName, TEMPLATE_CATALOGUE } from '../templates.ts';
import type { ChangeRecord } from '../types.ts';

const TITLE = 'Add foo';

const FLAT_SCOPE_COMMIT = '[{scope}|{type}: ]{title}';
const FLAT_SCOPE_MERGE = '[{ticket_ref} ][{scope}|{type}: ]{title}[ (#{pr_number})]';
const PROJECT_PR = '[{ticket_ref} ]{title}';
const GLOBAL_MERGE = '[{ticket_ref} ][{scope}|][{type}: ]{title}[ (#{pr_number})]';

describe(render, () => {
  describe('the catalogue templates', () => {
    const cases: Array<{ convention: ConventionName; expected: string; record: ChangeRecord }> = [
      { convention: 'pipedScope', record: { scope: 'agents', type: 'feat' }, expected: 'agents|feat: Add foo' },
      {
        convention: 'pipedScope',
        record: { breaking: true, scope: 'agents', type: 'feat' },
        expected: 'agents|feat!: Add foo',
      },
      { convention: 'pipedScope', record: { type: 'feat' }, expected: 'feat: Add foo' },
      { convention: 'pipedScope', record: { breaking: true, type: 'feat' }, expected: 'feat!: Add foo' },
      { convention: 'pipedScope', record: { scope: 'agents' }, expected: 'Add foo' },
      { convention: 'pipedScope', record: {}, expected: 'Add foo' },

      {
        convention: 'conventionalCommits',
        record: { scope: 'agents', type: 'feat' },
        expected: 'feat(agents): Add foo',
      },
      {
        convention: 'conventionalCommits',
        record: { breaking: true, scope: 'agents', type: 'feat' },
        expected: 'feat(agents)!: Add foo',
      },
      { convention: 'conventionalCommits', record: { type: 'feat' }, expected: 'feat: Add foo' },
      { convention: 'conventionalCommits', record: { breaking: true, type: 'feat' }, expected: 'feat!: Add foo' },

      { convention: 'typeOnly', record: { scope: 'agents', type: 'feat' }, expected: 'feat: Add foo' },
      { convention: 'typeOnly', record: { breaking: true, type: 'feat' }, expected: 'feat!: Add foo' },

      {
        convention: 'bracketedScope',
        record: { scope: 'agents', type: 'feat' },
        expected: '[agents] feat: Add foo',
      },
      {
        convention: 'bracketedScope',
        record: { breaking: true, scope: 'agents', type: 'feat' },
        expected: '[agents] feat!: Add foo',
      },
      { convention: 'bracketedScope', record: { type: 'feat' }, expected: 'feat: Add foo' },
    ];

    it.each(cases)('renders $convention from $record as "$expected"', ({ convention, expected, record }) => {
      expect(render(compileTemplate(TEMPLATE_CATALOGUE[convention]), { ...record, title: TITLE })).toBe(expected);
    });

    it.each(Object.entries(TEMPLATE_CATALOGUE))(
      'never renders the wildcard scope through %s',
      (_convention, template) => {
        expect(render(compileTemplate(template), { scope: '*', title: TITLE, type: 'feat' })).not.toContain('*');
      },
    );
  });

  describe('the configured preference templates', () => {
    it('renders the project commit template as it does today', () => {
      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), { scope: 'agents', title: TITLE, type: 'feat' })).toBe(
        'agents|feat: Add foo',
      );
    });

    it('renders the project merge template as it does today', () => {
      const record = { prNumber: '470', scope: 'agents', ticketRef: '#466', title: TITLE, type: 'feat' };

      expect(render(compileTemplate(FLAT_SCOPE_MERGE), record)).toBe('#466 agents|feat: Add foo (#470)');
    });

    it('renders the project PR template as it does today', () => {
      expect(render(compileTemplate(PROJECT_PR), { ticketRef: '#466', title: TITLE })).toBe('#466 Add foo');
    });

    it('renders the global merge template as it does today', () => {
      const record = { prNumber: '470', scope: 'agents', ticketRef: '#466', title: TITLE, type: 'feat' };

      expect(render(compileTemplate(GLOBAL_MERGE), record)).toBe('#466 agents|feat: Add foo (#470)');
    });

    it('renders the marker on the type, since no configured template names {breaking}', () => {
      const record = { breaking: true, scope: 'agents', title: TITLE, type: 'feat' };

      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), record)).toBe('agents|feat!: Add foo');
    });

    it('drops the whole prefix under the project commit template when the scope is absent', () => {
      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), { title: TITLE, type: 'feat' })).toBe('Add foo');
    });

    it('keeps the type prefix under the global merge template when the scope is absent', () => {
      expect(render(compileTemplate(GLOBAL_MERGE), { title: TITLE, type: 'feat' })).toBe('feat: Add foo');
    });
  });

  describe('group behavior', () => {
    it('drops a group whose direct token resolves empty, literals included', () => {
      expect(render(compileTemplate('[{ticket_ref} ]{title}'), { title: TITLE })).toBe('Add foo');
    });

    it('lets a nested group drop without taking its parent with it', () => {
      expect(render(compileTemplate('[[{scope}|]{type}: ]{title}'), { title: TITLE, type: 'fix' })).toBe(
        'fix: Add foo',
      );
    });

    it('keeps a group containing {breaking} when the change is not breaking', () => {
      expect(render(compileTemplate('[{type}{breaking}: ]{title}'), { title: TITLE, type: 'fix' })).toBe(
        'fix: Add foo',
      );
    });

    it('renders an empty template as an empty string', () => {
      expect(render(compileTemplate(''), { title: TITLE })).toBe('');
    });

    it('leaves an undeclared token in output, so a misspelling is visible', () => {
      expect(render(compileTemplate('{titel}'), { title: TITLE })).toBe('{titel}');
    });
  });

  describe('record normalization', () => {
    it('splits a type spelled with the marker into the bare type and the flag', () => {
      expect(render(compileTemplate('{type}{breaking}: {title}'), { title: TITLE, type: 'feat!' })).toBe(
        'feat!: Add foo',
      );
    });

    it('drops the wildcard scope, so its group drops with it', () => {
      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), { scope: '*', title: TITLE, type: 'feat' })).toBe('Add foo');
    });

    it('trims a padded value rather than emitting the padding', () => {
      expect(render(compileTemplate('{title}'), { title: '  Add foo  ' })).toBe('Add foo');
    });
  });

  describe('a scope naming several workspaces', () => {
    it('renders the workspaces comma-joined', () => {
      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), { scope: 'agents,kb', title: TITLE, type: 'feat' })).toBe(
        'agents,kb|feat: Add foo',
      );
    });

    it('trims each workspace and drops the empty elements', () => {
      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), { scope: ' agents , , kb ', title: TITLE, type: 'feat' })).toBe(
        'agents,kb|feat: Add foo',
      );
    });

    it('drops a wildcard element, keeping the workspaces beside it', () => {
      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), { scope: 'agents,*', title: TITLE, type: 'feat' })).toBe(
        'agents|feat: Add foo',
      );
    });

    it('drops a repeated workspace, keeping first-occurrence order', () => {
      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), { scope: 'kb,agents,kb', title: TITLE, type: 'feat' })).toBe(
        'kb,agents|feat: Add foo',
      );
    });

    it('names no scope when every element drops, so the group drops with it', () => {
      expect(render(compileTemplate(FLAT_SCOPE_COMMIT), { scope: '*,,*', title: TITLE, type: 'feat' })).toBe('Add foo');
    });
  });
});
