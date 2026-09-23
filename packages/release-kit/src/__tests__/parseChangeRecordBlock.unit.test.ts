import { describe, expect, it } from 'vitest';

import { parseChangeRecordBlock } from '../parseChangeRecordBlock.ts';

describe(parseChangeRecordBlock, () => {
  it('reads a message with no block as absent', () => {
    expect(parseChangeRecordBlock('#1 feat: Add a thing\n\nBody text.')).toStrictEqual({ kind: 'absent' });
  });

  it('ignores a fence whose info string is not exactly `change-record`', () => {
    const message = messageWith('```change-record-v2\nentries: []\n```\n\n```yaml\nentries: []\n```');

    expect(parseChangeRecordBlock(message)).toStrictEqual({ kind: 'absent' });
  });

  it('reads entries, `pr_number`, and `ticket_ref` from a merge-commit block', () => {
    const message = messageWith(
      block(`
pr_number: 42
ticket_ref: '#867'
entries:
  - type: feat
    scopes:
      - release-kit
    breaking: true
    text: Adds the parser.
    migration: Replace \`old()\` with \`new()\`.
  - type: fix
    text: Corrects the guard.
`),
    );

    expect(parseChangeRecordBlock(message)).toStrictEqual({
      kind: 'read',
      entries: [
        {
          breaking: true,
          migration: 'Replace `old()` with `new()`.',
          scopes: ['release-kit'],
          text: 'Adds the parser.',
          type: 'feat',
        },
        { breaking: false, scopes: [], text: 'Corrects the guard.', type: 'fix' },
      ],
      prNumber: 42,
      ticketRef: '#867',
    });
  });

  it('reads the last block when the message contains several', () => {
    const message = messageWith(
      `${block('entries:\n  - type: fix\n    text: First.')}\n\n${block('entries:\n  - type: feat\n    text: Last.')}`,
    );

    expect(parseChangeRecordBlock(message)).toStrictEqual({
      kind: 'read',
      entries: [{ breaking: false, scopes: [], text: 'Last.', type: 'feat' }],
    });
  });

  it('reads a CRLF message', () => {
    const message = messageWith(block('entries:\n  - type: fix\n    text: Done.')).replaceAll('\n', '\r\n');

    expect(parseChangeRecordBlock(message)).toStrictEqual({
      kind: 'read',
      entries: [{ breaking: false, scopes: [], text: 'Done.', type: 'fix' }],
    });
  });

  it('keeps the entry text as written, apart from surrounding whitespace', () => {
    const message = messageWith(block("entries:\n  - type: fix\n    text: '  lowercase start.  '"));

    expect(parseChangeRecordBlock(message)).toMatchObject({
      entries: [{ text: 'lowercase start.' }],
    });
  });

  describe('absent and empty entries', () => {
    it.each([
      ['absent', 'pr_number: 7'],
      ['null', 'pr_number: 7\nentries:'],
      ['empty', 'pr_number: 7\nentries: []'],
    ])('reads %s `entries` as an empty list', (_label, payload) => {
      expect(parseChangeRecordBlock(messageWith(block(payload)))).toStrictEqual({
        kind: 'read',
        entries: [],
        prNumber: 7,
      });
    });
  });

  describe('null-valued declared keys', () => {
    it('reads each null-valued declared key as absent', () => {
      const message = messageWith(
        block(`
pr_number:
ticket_ref:
entries:
  - type: fix
    text: Done.
    breaking:
    scopes:
    migration:
`),
      );

      expect(parseChangeRecordBlock(message)).toStrictEqual({
        kind: 'read',
        entries: [{ breaking: false, scopes: [], text: 'Done.', type: 'fix' }],
      });
    });

    it('ignores undeclared keys', () => {
      const message = messageWith(
        block('title: Something\nentries_commit: 123\nentries:\n  - type: fix\n    text: Done.\n    extra: [1]'),
      );

      expect(parseChangeRecordBlock(message)).toStrictEqual({
        kind: 'read',
        entries: [{ breaking: false, scopes: [], text: 'Done.', type: 'fix' }],
      });
    });
  });

  describe('malformed blocks', () => {
    it('reports a block that never closes', () => {
      const message = messageWith('```change-record\nentries: []\n');

      expect(parseChangeRecordBlock(message)).toStrictEqual({
        kind: 'malformed',
        reason: 'the block opens but never closes',
      });
    });

    it('reports a payload that is not valid YAML', () => {
      const reading = parseChangeRecordBlock(messageWith(block('entries: [unclosed')));

      expect(reading.kind).toBe('malformed');
      expect(reading).toHaveProperty('reason', expect.stringMatching(/^the payload is not valid YAML: /));
    });

    it.each([
      ['the payload is a list', '- a\n- b', 'the payload is not a mapping'],
      ['the payload is a scalar', 'just text', 'the payload is not a mapping'],
      ['the payload is empty', '', 'the payload is not a mapping'],
      ['`entries` is a mapping', 'entries:\n  type: fix', '`entries` is not a list'],
      ['an entry is a scalar', 'entries:\n  - fix', '`entries[0]` is not a mapping'],
      ['`type` is missing', 'entries:\n  - text: Done.', '`entries[0].type` is missing'],
      ['`type` is blank', "entries:\n  - type: ' '\n    text: Done.", '`entries[0].type` is blank'],
      ['`type` is not a string', 'entries:\n  - type: 3\n    text: Done.', '`entries[0].type` is not a string'],
      ['`text` is missing', 'entries:\n  - type: fix', '`entries[0].text` is missing'],
      ['`text` is blank', "entries:\n  - type: fix\n    text: ''", '`entries[0].text` is blank'],
      ['`text` is not a string', 'entries:\n  - type: fix\n    text: [a]', '`entries[0].text` is not a string'],
      [
        '`breaking` is not a boolean',
        "entries:\n  - type: fix\n    text: Done.\n    breaking: 'yes'",
        '`entries[0].breaking` is not a boolean',
      ],
      [
        '`scopes` is not a list',
        'entries:\n  - type: fix\n    text: Done.\n    scopes: release-kit',
        '`entries[0].scopes` is not a list',
      ],
      [
        '`scopes` holds a non-string',
        'entries:\n  - type: fix\n    text: Done.\n    scopes: [a, 1]',
        '`entries[0].scopes[1]` is not a string',
      ],
      [
        '`migration` is not a string',
        'entries:\n  - type: fix\n    text: Done.\n    migration: [a]',
        '`entries[0].migration` is not a string',
      ],
      ['`pr_number` is a string', "pr_number: '42'", '`pr_number` is not a positive integer'],
      ['`pr_number` is zero', 'pr_number: 0', '`pr_number` is not a positive integer'],
      ['`pr_number` is negative', 'pr_number: -3', '`pr_number` is not a positive integer'],
      ['`pr_number` is fractional', 'pr_number: 4.5', '`pr_number` is not a positive integer'],
      ['`ticket_ref` is not a string', 'ticket_ref: 867', '`ticket_ref` is not a string'],
    ])('reports a block in which %s', (_label, payload, reason) => {
      expect(parseChangeRecordBlock(messageWith(block(payload)))).toStrictEqual({ kind: 'malformed', reason });
    });

    it('reports the whole block when any one entry is defective', () => {
      const message = messageWith(block('entries:\n  - type: feat\n    text: Good.\n  - type: fix'));

      expect(parseChangeRecordBlock(message)).toStrictEqual({
        kind: 'malformed',
        reason: '`entries[1].text` is missing',
      });
    });

    it('reads the last block even when an earlier one is malformed', () => {
      const message = messageWith(`${block('entries: 3')}\n\n${block('entries:\n  - type: fix\n    text: Done.')}`);

      expect(parseChangeRecordBlock(message)).toMatchObject({ kind: 'read' });
    });

    it('reports the last block when it is malformed even though an earlier one reads', () => {
      const message = messageWith(`${block('entries:\n  - type: fix\n    text: Done.')}\n\n${block('entries: 3')}`);

      expect(parseChangeRecordBlock(message)).toStrictEqual({ kind: 'malformed', reason: '`entries` is not a list' });
    });
  });
});

// region | Helpers

/** Wraps a YAML payload in a `change-record` fence. */
function block(payload: string): string {
  return ['```change-record', payload.replace(/^\n/, '').replace(/\n$/, ''), '```'].join('\n');
}

/** Builds a merge-commit message whose body ends with the given text. */
function messageWith(tail: string): string {
  return `#867 release-kit|feat: Read the block (#42)\n\nLede paragraph.\n\n${tail}\n`;
}

// endregion | Helpers
