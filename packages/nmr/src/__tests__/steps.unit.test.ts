import { describe, expect, it } from 'vitest';

import type { Step } from '../steps.ts';
import { composeNmrStep, renderChain } from '../steps.ts';

describe(composeNmrStep, () => {
  it('composes a bare command name as an nmr invocation', () => {
    expect(composeNmrStep('fmt:check', false)).toStrictEqual({ kind: 'structural', argv: ['nmr', 'fmt:check'] });
  });

  it('prepends -w as its own token when workspaceRoot is true', () => {
    expect(composeNmrStep('fmt:check', true)).toStrictEqual({ kind: 'structural', argv: ['nmr', '-w', 'fmt:check'] });
  });

  it('tokenizes an element carrying nmr flags on whitespace', () => {
    expect(composeNmrStep('-q build', false)).toStrictEqual({ kind: 'structural', argv: ['nmr', '-q', 'build'] });
  });

  it('keeps -w ahead of the flags the element carries', () => {
    expect(composeNmrStep('-q build', true)).toStrictEqual({ kind: 'structural', argv: ['nmr', '-w', '-q', 'build'] });
  });

  it('drops the empty tokens surrounding and repeated whitespace would leave', () => {
    expect(composeNmrStep('  -q   build ', false)).toStrictEqual({ kind: 'structural', argv: ['nmr', '-q', 'build'] });
  });
});

describe(renderChain, () => {
  it('renders an opaque step as its own text', () => {
    expect(renderChain([{ kind: 'opaque', command: 'eslint --fix .' }])).toBe('eslint --fix .');
  });

  it('renders a structural step by joining its argv', () => {
    expect(renderChain([{ kind: 'structural', argv: ['nmr', '-w', 'test'] }])).toBe('nmr -w test');
  });

  it('joins steps with the operator that short-circuits the chain on failure', () => {
    const steps: readonly Step[] = [
      { kind: 'structural', argv: ['nmr', 'fmt'] },
      { kind: 'opaque', command: 'eslint .' },
    ];

    expect(renderChain(steps)).toBe('nmr fmt && eslint .');
  });

  it('renders an empty step list as the empty string', () => {
    expect(renderChain([])).toBe('');
  });

  it('leaves the shell syntax an opaque step carries untouched', () => {
    const command = 'nmr root:test && pnpm --recursive exec nmr test';

    expect(renderChain([{ kind: 'opaque', command }])).toBe(command);
  });

  it('leaves a structural token the shell reads literally bare', () => {
    const argv = ['pnpm', '--filter', '@scope/pkg', 'exec', 'nmr', 'build'];

    expect(renderChain([{ kind: 'structural', argv }])).toBe('pnpm --filter @scope/pkg exec nmr build');
  });

  // A structural token is a single argument, so anything the shell would act on has to survive rendering as text.
  it.each([
    { expected: "'./packages/*'", scenario: 'a glob', token: './packages/*' },
    { expected: "'a b'", scenario: 'a space', token: 'a b' },
    { expected: "'$HOME'", scenario: 'a variable reference', token: '$HOME' },
    { expected: String.raw`'it'\''s'`, scenario: 'a single quote', token: "it's" },
    { expected: "''", scenario: 'nothing at all', token: '' },
  ])('quotes a structural token holding $scenario', ({ expected, token }) => {
    expect(renderChain([{ kind: 'structural', argv: ['pnpm', token] }])).toBe(`pnpm ${expected}`);
  });
});
