import { describe, expect, it } from 'vitest';

import { compileTemplate } from '../compile-template.ts';

describe(compileTemplate, () => {
  it('compiles a template with no markup to one literal node', () => {
    expect(compileTemplate('Add foo')).toStrictEqual([{ kind: 'literal', text: 'Add foo' }]);
  });

  it('compiles a declared token to a token node', () => {
    expect(compileTemplate('{title}')).toStrictEqual([{ kind: 'token', name: 'title' }]);
  });

  it('leaves an undeclared token literal, so a misspelling shows up in output', () => {
    expect(compileTemplate('{titel}')).toStrictEqual([{ kind: 'literal', text: '{titel}' }]);
  });

  it('leaves an unclosed brace literal', () => {
    expect(compileTemplate('{title')).toStrictEqual([{ kind: 'literal', text: '{title' }]);
  });

  it('merges neighbouring literal characters into one node', () => {
    expect(compileTemplate('a: {title}')).toStrictEqual([
      { kind: 'literal', text: 'a: ' },
      { kind: 'token', name: 'title' },
    ]);
  });

  it('compiles a bracketed run to a group holding its children', () => {
    expect(compileTemplate('[{scope}|]')).toStrictEqual([
      {
        kind: 'group',
        children: [
          { kind: 'token', name: 'scope' },
          { kind: 'literal', text: '|' },
        ],
      },
    ]);
  });

  it('nests a group inside a group', () => {
    expect(compileTemplate('[[{scope}|]{type}]')).toStrictEqual([
      {
        kind: 'group',
        children: [
          {
            kind: 'group',
            children: [
              { kind: 'token', name: 'scope' },
              { kind: 'literal', text: '|' },
            ],
          },
          { kind: 'token', name: 'type' },
        ],
      },
    ]);
  });

  it('turns an escaped bracket into literal text rather than a group', () => {
    expect(compileTemplate(String.raw`\[{scope}\]`)).toStrictEqual([
      { kind: 'literal', text: '[' },
      { kind: 'token', name: 'scope' },
      { kind: 'literal', text: ']' },
    ]);
  });

  it('turns a doubled backslash into one literal backslash', () => {
    expect(compileTemplate(String.raw`\\`)).toStrictEqual([{ kind: 'literal', text: '\\' }]);
  });

  it('keeps a backslash that escapes nothing as literal text', () => {
    expect(compileTemplate(String.raw`\n`)).toStrictEqual([{ kind: 'literal', text: String.raw`\n` }]);
  });

  it('refuses an unclosed group, naming the template', () => {
    expect(() => compileTemplate('[{scope}|{title}')).toThrow(
      /Unclosed "\[" group in template "\[\{scope\}\|\{title\}"/,
    );
  });

  it('refuses an unmatched closing bracket, naming the template', () => {
    expect(() => compileTemplate('{title}]')).toThrow(/Unmatched "\]" in template "\{title\}\]"/);
  });
});
