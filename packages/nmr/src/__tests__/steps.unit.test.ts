import { describe, expect, it } from 'vitest';

import type { Step } from '../steps.ts';
import { composeNmrStep, findNmrCrossing, findUnexpressibleToken, readNmrStep, renderChain } from '../steps.ts';

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

describe(findNmrCrossing, () => {
  it.each([
    { command: 'nmr fmt', scenario: 'the step itself' },
    { command: '  nmr fmt', scenario: 'the step past the whitespace padding it' },
    { command: 'rdy verify && nmr compile', scenario: 'a segment following &&' },
    { command: 'rdy verify || nmr compile', scenario: 'a segment following ||' },
    { command: 'rdy verify; nmr compile', scenario: 'a segment following ;' },
    { command: 'cat log | nmr compile', scenario: 'a segment following |' },
    { command: 'FORCE_COLOR=1 nmr build', scenario: 'a segment behind an environment assignment' },
    { command: String.raw`echo 'a \' && nmr b`, scenario: 'a segment past a backslash single quotes read literally' },
    { command: 'npx nmr build', scenario: 'npx' },
    { command: 'npx --yes nmr build', scenario: 'npx carrying a flag' },
    { command: 'bunx nmr build', scenario: 'bunx' },
    { command: 'bun x nmr build', scenario: 'bun x' },
    { command: 'npm exec nmr build', scenario: 'npm exec' },
    { command: 'yarn dlx nmr build', scenario: 'yarn dlx' },
    { command: 'pnpm exec nmr build', scenario: 'pnpm exec' },
    { command: 'pnpm --recursive exec nmr test', scenario: 'pnpm exec behind a flag' },
    { command: 'pnpm --filter foo exec nmr build', scenario: 'pnpm exec behind a flag taking a value' },
  ])('given nmr in command position at $scenario, returns the whole step', ({ command }) => {
    expect(findNmrCrossing([{ kind: 'opaque', command }])).toBe(command);
  });

  it('returns the leftmost qualifying step when a list holds several', () => {
    const steps: readonly Step[] = [
      { kind: 'structural', argv: ['nmr', 'fmt'] },
      { kind: 'opaque', command: 'rdy verify && nmr first' },
      { kind: 'opaque', command: 'nmr second' },
    ];

    expect(findNmrCrossing(steps)).toBe('rdy verify && nmr first');
  });

  it.each<{ scenario: string; steps: readonly Step[] }>([
    { scenario: 'a structural step nmr composed', steps: [{ kind: 'structural', argv: ['nmr', 'typecheck'] }] },
    { scenario: 'an empty step list', steps: [] },
    {
      scenario: 'a step whose leading token merely begins with nmr',
      steps: [{ kind: 'opaque', command: 'nmr-compile' }],
    },
    {
      scenario: 'a separator standing inside double quotes',
      steps: [{ kind: 'opaque', command: 'echo "a && nmr b"' }],
    },
    {
      scenario: 'a separator standing inside single quotes',
      steps: [{ kind: 'opaque', command: "echo 'a; nmr b'" }],
    },
    {
      scenario: 'a separator the shell reads literally',
      steps: [{ kind: 'opaque', command: String.raw`echo a \&\& nmr b` }],
    },
    {
      scenario: 'a separator past an escaped quote inside a double-quoted run',
      steps: [{ kind: 'opaque', command: String.raw`echo "a \" && nmr b"` }],
    },
    { scenario: 'nmr named as an argument', steps: [{ kind: 'opaque', command: 'grep nmr package.json' }] },
    {
      scenario: 'a package named nmr selected by a filter',
      steps: [{ kind: 'opaque', command: 'pnpm --filter nmr build' }],
    },
    { scenario: 'a script named nmr', steps: [{ kind: 'opaque', command: 'pnpm run nmr' }] },
    // The documented residual: a value-taking flag standing immediately before the program name hides it.
    { scenario: 'npx given a package flag', steps: [{ kind: 'opaque', command: 'npx -p foo nmr build' }] },
  ])('given $scenario, finds nothing', ({ steps }) => {
    expect(findNmrCrossing(steps)).toBeUndefined();
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

describe(readNmrStep, () => {
  it.each([
    { argv: ['nmr', 'fmt:check'], expected: { command: 'fmt:check', isDelegate: false }, scenario: 'a bare command' },
    { argv: ['nmr', '-w', 'test'], expected: { command: 'test', isDelegate: false }, scenario: 'a -w element' },
    { argv: ['nmr', '-q', 'build'], expected: { command: 'build', isDelegate: false }, scenario: 'a flag it carries' },
    { argv: ['nmr', '-R', 'test'], expected: { command: 'test', isDelegate: true }, scenario: 'a -R delegate' },
    {
      argv: ['nmr', '--filter', 'core', 'test'],
      expected: { command: 'test', isDelegate: true },
      scenario: 'a --filter delegate, past the pattern',
    },
  ])('reads the command behind $scenario', ({ argv, expected }) => {
    expect(readNmrStep(composeStep(argv))).toStrictEqual(expected);
  });

  it.each([
    { argv: ['nmr'], scenario: 'a step naming no command' },
    { argv: ['nmr', '-R'], scenario: 'a delegate naming no command' },
    { argv: ['pnpm', '--recursive', 'exec', 'nmr', 'test'], scenario: 'a step spawning something other than nmr' },
  ])('reports nothing for $scenario', ({ argv }) => {
    expect(readNmrStep(composeStep(argv))).toBeUndefined();
  });

  it('reports nothing for an opaque step, whose text nmr does not parse', () => {
    expect(readNmrStep({ kind: 'opaque', command: 'nmr test' })).toBeUndefined();
  });

  it('reads back what composeNmrStep composed', () => {
    expect(readNmrStep(composeNmrStep('-R test:coverage', true))).toStrictEqual({
      command: 'test:coverage',
      isDelegate: true,
    });
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

// region | Helpers

/** Builds the structural step whose argv is the given tokens. */
function composeStep(argv: readonly string[]): Step {
  const [file = '', ...rest] = argv;

  return { kind: 'structural', argv: [file, ...rest] };
}

// endregion | Helpers
