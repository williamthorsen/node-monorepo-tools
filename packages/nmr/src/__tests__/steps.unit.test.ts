import { describe, expect, it } from 'vitest';

import type { Step } from '../steps.ts';
import { composeNmrStep, findShelledNmrStep, findUnexpressibleToken, renderChain } from '../steps.ts';

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

describe(findShelledNmrStep, () => {
  it('finds an opaque step leading with the nmr token', () => {
    const steps: readonly Step[] = [{ kind: 'opaque', command: 'nmr root:test && pnpm --recursive exec nmr test' }];

    expect(findShelledNmrStep(steps)).toBe('nmr root:test && pnpm --recursive exec nmr test');
  });

  it('reads past the whitespace a step is padded with', () => {
    expect(findShelledNmrStep([{ kind: 'opaque', command: '  nmr fmt' }])).toBe('  nmr fmt');
  });

  it('returns the leftmost qualifying step when a list holds several', () => {
    const steps: readonly Step[] = [
      { kind: 'structural', argv: ['nmr', 'fmt'] },
      { kind: 'opaque', command: 'nmr first' },
      { kind: 'opaque', command: 'nmr second' },
    ];

    expect(findShelledNmrStep(steps)).toBe('nmr first');
  });

  it.each([
    { scenario: 'a structural step nmr composed', steps: [{ kind: 'structural', argv: ['nmr', 'typecheck'] }] },
    {
      scenario: 'a step reaching nmr through another program',
      steps: [{ kind: 'opaque', command: 'pnpm exec nmr build' }],
    },
    {
      scenario: 'a step whose leading token merely begins with nmr',
      steps: [{ kind: 'opaque', command: 'nmr-compile' }],
    },
    { scenario: 'an empty step list', steps: [] },
  ])('given $scenario, finds nothing', ({ steps }) => {
    expect(findShelledNmrStep(steps as readonly Step[])).toBeUndefined();
  });
});

describe(findUnexpressibleToken, () => {
  it.each([
    { element: 'fmt:check', scenario: 'a bare command name' },
    { element: '-q build', scenario: 'a command name preceded by an nmr flag' },
    { element: '  fmt   ', scenario: 'an element padded with whitespace' },
  ])('given $scenario, finds nothing', ({ element }) => {
    expect(findUnexpressibleToken(element)).toBeUndefined();
  });

  it.each([
    { element: "lint --ignore-pattern 'packages/**'", expected: "'packages/**'", scenario: 'a quoted argument' },
    { element: 'build && echo done', expected: '&&', scenario: 'a shell operator' },
    { element: 'test --reporter=$REPORTER', expected: '--reporter=$REPORTER', scenario: 'a variable reference' },
  ])('given $scenario, returns the token that puts it outside the grammar', ({ element, expected }) => {
    expect(findUnexpressibleToken(element)).toBe(expected);
  });

  it('returns the leftmost offending token when the element holds several', () => {
    expect(findUnexpressibleToken('build && echo $HOME')).toBe('&&');
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
    const argv = ['pnpm', '--filter', '@scope/pkg', 'exec', 'nmr', 'build'] as const;

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
