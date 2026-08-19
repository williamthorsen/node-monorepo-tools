import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, test } from 'vitest';

import {
  applyDevBin,
  buildRootRegistry,
  buildWorkspaceRegistry,
  describeScript,
  expandScript,
  findChainedSelfReference,
  resolveScript,
} from '../resolver.ts';
import { UserError } from '../UserError.ts';

const it = test.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-test-' })),
);

describe(applyDevBin, () => {
  const monorepoRoot = '/repo';

  it('replaces a matching first token with the devBin command', () => {
    const devBin = { 'my-cli': 'tsx packages/my-cli/src/cli.ts' };
    const result = applyDevBin('my-cli --verbose', devBin, monorepoRoot);

    expect(result).toBe('tsx /repo/packages/my-cli/src/cli.ts --verbose');
  });

  it('replaces a command with no arguments', () => {
    const devBin = { 'my-cli': 'tsx packages/my-cli/src/cli.ts' };
    const result = applyDevBin('my-cli', devBin, monorepoRoot);

    expect(result).toBe('tsx /repo/packages/my-cli/src/cli.ts');
  });

  it('returns the command unchanged when no match exists', () => {
    const devBin = { 'other-cli': 'tsx other.ts' };
    const result = applyDevBin('my-cli --flag', devBin, monorepoRoot);

    expect(result).toBe('my-cli --flag');
  });

  it('returns the command unchanged when devBin is undefined', () => {
    const result = applyDevBin('my-cli --flag', undefined, monorepoRoot);

    expect(result).toBe('my-cli --flag');
  });

  it('returns the command unchanged when devBin is empty', () => {
    const result = applyDevBin('my-cli --flag', {}, monorepoRoot);

    expect(result).toBe('my-cli --flag');
  });

  it('resolves relative paths in replacement but not flags', () => {
    const devBin = { build: 'node scripts/build.js --config config/build.json' };
    const result = applyDevBin('build src/', devBin, monorepoRoot);

    expect(result).toBe('node /repo/scripts/build.js --config /repo/config/build.json src/');
  });

  it('does not resolve the runner binary even if it contains a slash', () => {
    const devBin = { 'my-cli': 'runners/tsx packages/cli/index.ts' };
    const result = applyDevBin('my-cli', devBin, monorepoRoot);

    expect(result).toBe('runners/tsx /repo/packages/cli/index.ts');
  });
});

describe(expandScript, () => {
  it('holds a string script as a single opaque step', () => {
    expect(expandScript('vitest', false)).toStrictEqual([{ kind: 'opaque', command: 'vitest' }]);
  });

  it('holds a string script as a single opaque step regardless of workspaceRoot', () => {
    expect(expandScript('vitest', true)).toStrictEqual([{ kind: 'opaque', command: 'vitest' }]);
  });

  it('expands an array to one structural step per element', () => {
    expect(expandScript(['fmt', 'lint'], false)).toStrictEqual([
      { kind: 'structural', argv: ['nmr', 'fmt'] },
      { kind: 'structural', argv: ['nmr', 'lint'] },
    ]);
  });

  it('expands a single-element array', () => {
    expect(expandScript(['test'], false)).toStrictEqual([{ kind: 'structural', argv: ['nmr', 'test'] }]);
  });

  it('propagates -w to each step when workspaceRoot is true', () => {
    expect(expandScript(['fmt', 'lint'], true)).toStrictEqual([
      { kind: 'structural', argv: ['nmr', '-w', 'fmt'] },
      { kind: 'structural', argv: ['nmr', '-w', 'lint'] },
    ]);
  });

  it('propagates -w to a single-element array when workspaceRoot is true', () => {
    expect(expandScript(['test'], true)).toStrictEqual([{ kind: 'structural', argv: ['nmr', '-w', 'test'] }]);
  });

  it('composes a `run` spec into the step its bare string composes', () => {
    expect(expandScript([{ run: '-R test' }], false)).toStrictEqual(expandScript(['-R test'], false));
  });

  it('carries a declining spec onto its step', () => {
    expect(expandScript([{ run: 'typecheck', declinesArgs: true }, 'test'], false)).toStrictEqual([
      { kind: 'structural', argv: ['nmr', 'typecheck'], declinesArgs: true },
      { kind: 'structural', argv: ['nmr', 'test'] },
    ]);
  });

  // The check-result cache keys on the rendered chain, so an accepting step that carried the property would
  // invalidate every recorded pass the moment the defaults declared anything.
  it('leaves an accepting spec indistinguishable from a bare element', () => {
    expect(expandScript([{ run: 'test', declinesArgs: false }], false)).toStrictEqual([
      { kind: 'structural', argv: ['nmr', 'test'] },
    ]);
  });

  it('propagates -w to a spec element', () => {
    expect(expandScript([{ run: 'typecheck', declinesArgs: true }], true)).toStrictEqual([
      { kind: 'structural', argv: ['nmr', '-w', 'typecheck'], declinesArgs: true },
    ]);
  });
});

describe(describeScript, () => {
  it('describes a string script as itself', () => {
    expect(describeScript('vitest --coverage')).toBe('vitest --coverage');
  });

  it('describes an array script with brackets', () => {
    expect(describeScript(['fmt', 'lint'])).toBe('[fmt, lint]');
  });

  it('names a declining element, which reads alike otherwise', () => {
    expect(describeScript([{ run: 'typecheck', declinesArgs: true }, { run: 'test' }])).toBe(
      '[typecheck (no args), test]',
    );
  });
});

describe(buildWorkspaceRegistry, () => {
  it('merges config overrides on top of defaults', () => {
    const registry = buildWorkspaceRegistry({ workspaceScripts: { 'copy-content': 'tsx scripts/copy-content.ts' } });

    expect(registry).toMatchObject({
      build: ['compile'],
      'copy-content': 'tsx scripts/copy-content.ts',
    });
  });

  it('allows config to override default scripts', () => {
    const registry = buildWorkspaceRegistry({ workspaceScripts: { clean: 'rm -rf dist' } });

    expect(registry['clean']).toBe('rm -rf dist');
  });
});

describe(buildRootRegistry, () => {
  it('merges config overrides on top of defaults', () => {
    const registry = buildRootRegistry({
      rootScripts: { 'demo:catwalk': 'pnpx http-server --port=5189' },
    });

    expect(registry).toMatchObject({
      ci: [{ run: 'build', declinesArgs: true }, 'check:strict'],
      'demo:catwalk': 'pnpx http-server --port=5189',
    });
  });
});

describe(findChainedSelfReference, () => {
  it.for([
    { scenario: 'ahead of the steps it chains', script: 'nmr build && rdy compile' },
    { scenario: 'behind the steps it chains', script: 'rdy compile && nmr build' },
  ])('returns an entry re-invoking its own command $scenario', ({ script }, { tree }) => {
    writeScripts(tree.dir, { build: script });

    expect(findChainedSelfReference(tree.dir, 'build')).toBe(script);
  });

  it.for([
    { scenario: 'a self-reference standing alone', scripts: { build: 'nmr build' } },
    { scenario: 'a self-reference carrying trailing arguments', scripts: { build: 'nmr build --verbose' } },
    { scenario: 'an entry naming another command', scripts: { build: 'nmr compile && rdy compile' } },
    { scenario: 'an entry naming no nmr command', scripts: { build: 'tsx build.ts' } },
    { scenario: 'no entry for the command', scripts: { test: 'vitest' } },
  ])('reports nothing for $scenario', ({ scripts }, { tree }) => {
    writeScripts(tree.dir, scripts);

    expect(findChainedSelfReference(tree.dir, 'build')).toBeUndefined();
  });

  it('reports nothing for a command named for an `Object.prototype` member', ({ tree }) => {
    writeScripts(tree.dir, { build: 'tsx build.ts' });

    expect(findChainedSelfReference(tree.dir, 'constructor')).toBeUndefined();
  });

  it('reports nothing when no package anchors the resolution', () => {
    expect(findChainedSelfReference(undefined, 'build')).toBeUndefined();
  });
});

describe(resolveScript, () => {
  it('resolves from the registry when no package override exists', () => {
    const registry = { test: 'vitest' };
    const result = resolveScript('test', registry, undefined, false);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'test' },
      steps: [{ kind: 'opaque', command: 'vitest' }],
    });
  });

  it('expands array scripts from the registry', () => {
    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, undefined, false);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'build' },
      steps: [
        { kind: 'structural', argv: ['nmr', 'fmt'] },
        { kind: 'structural', argv: ['nmr', 'lint'] },
      ],
    });
  });

  it('propagates -w through composite expansion when workspaceRoot is true', () => {
    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, undefined, true);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'build' },
      steps: [
        { kind: 'structural', argv: ['nmr', '-w', 'fmt'] },
        { kind: 'structural', argv: ['nmr', '-w', 'lint'] },
      ],
    });
  });

  it('returns undefined for unknown commands', () => {
    const registry = { test: 'vitest' };
    expect(resolveScript('unknown', registry, undefined, false)).toBeUndefined();
  });

  // The registry is a plain object, so `'constructor' in registry` is true and the inherited value is a function.
  // Reaching the expansion step with one throws instead of reporting an unknown command.
  it('returns undefined for a command named for an `Object.prototype` member', () => {
    const registry = { test: 'vitest' };
    expect(resolveScript('constructor', registry, undefined, false)).toBeUndefined();
    expect(resolveScript('toString', registry, undefined, false)).toBeUndefined();
  });

  it('does not treat an `Object.prototype` member as a package.json override', ({ tree }) => {
    fs.writeFileSync(
      path.join(tree.dir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { test: 'jest' } }),
    );

    expect(resolveScript('constructor', { test: 'vitest' }, tree.dir, false)).toBeUndefined();
  });

  it('uses package.json override when present (tier 3)', ({ tree }) => {
    fs.writeFileSync(
      path.join(tree.dir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { test: 'jest' } }),
    );

    const registry = { test: 'vitest' };
    const result = resolveScript('test', registry, tree.dir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'package', file: path.join(tree.dir, 'package.json'), key: 'test' },
      steps: [{ kind: 'opaque', command: 'jest' }],
    });
  });

  it('does not rewrite tier-3 override strings when workspaceRoot is true', ({ tree }) => {
    fs.writeFileSync(
      path.join(tree.dir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { build: 'nmr compile' } }),
    );

    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, tree.dir, true);

    // User-authored override strings pass through untouched; only generated
    // chains receive the -w flag.
    expect(result).toStrictEqual({
      origin: { tier: 'package', file: path.join(tree.dir, 'package.json'), key: 'build' },
      steps: [{ kind: 'opaque', command: 'nmr compile' }],
    });
  });

  it('skips execution when package.json override is empty string', ({ tree }) => {
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ name: 'test-pkg', scripts: { lint: '' } }));

    const registry = { lint: 'eslint .' };
    const result = resolveScript('lint', registry, tree.dir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'package', file: path.join(tree.dir, 'package.json'), key: 'lint' },
      steps: [{ kind: 'opaque', command: '' }],
    });
  });

  it('skips self-referential package.json override (exact match)', ({ tree }) => {
    fs.writeFileSync(
      path.join(tree.dir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { build: 'nmr build' } }),
    );

    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, tree.dir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'build' },
      steps: [
        { kind: 'structural', argv: ['nmr', 'fmt'] },
        { kind: 'structural', argv: ['nmr', 'lint'] },
      ],
    });
  });

  it('skips self-referential package.json override (with trailing args)', ({ tree }) => {
    fs.writeFileSync(
      path.join(tree.dir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { build: 'nmr build --verbose' } }),
    );

    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, tree.dir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'build' },
      steps: [
        { kind: 'structural', argv: ['nmr', 'fmt'] },
        { kind: 'structural', argv: ['nmr', 'lint'] },
      ],
    });
  });

  it.for([
    { scenario: 'ahead of the steps it chains', script: 'nmr build && rdy compile' },
    { scenario: 'behind the steps it chains', script: 'rdy compile && nmr build' },
  ])('skips a self-referential package.json override standing $scenario', ({ script }, { tree }) => {
    writeScripts(tree.dir, { build: script });

    const registry = { build: ['fmt', 'lint'] };

    expect(resolveScript('build', registry, tree.dir, false)).toStrictEqual({
      origin: { tier: 'registry', key: 'build' },
      steps: [
        { kind: 'structural', argv: ['nmr', 'fmt'] },
        { kind: 'structural', argv: ['nmr', 'lint'] },
      ],
    });
  });

  // The build-output probe and the workspace clean sweep resolve scripts for packages nobody named, so a
  // chained entry must not fail the command that happens to be running.
  it('resolves another command from a package whose entry chains a self-reference', ({ tree }) => {
    writeScripts(tree.dir, { build: 'nmr build && rdy compile' });

    const registry = { compile: 'nmr-compile' };

    expect(resolveScript('compile', registry, tree.dir, false)).toStrictEqual({
      origin: { tier: 'registry', key: 'compile' },
      steps: [{ kind: 'opaque', command: 'nmr-compile' }],
    });
  });

  it('does not skip non-self-referential nmr override', ({ tree }) => {
    fs.writeFileSync(
      path.join(tree.dir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { build: 'nmr compile' } }),
    );

    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, tree.dir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'package', file: path.join(tree.dir, 'package.json'), key: 'build' },
      steps: [{ kind: 'opaque', command: 'nmr compile' }],
    });
  });

  it.for([
    {
      expected:
        '`scripts.build` must be a string. A step list belongs in `.config/nmr.config.ts` under `workspaceScripts`.',
      scenario: 'a step list written into a package',
      setup: (dir: string) => writeScripts(dir, { build: ['compile'] }),
    },
    {
      expected: '`scripts.build` must be a string. A step list belongs in `.config/nmr.config.ts` under `rootScripts`.',
      scenario: 'a step list written into the monorepo root',
      setup: (dir: string) => {
        fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
        writeScripts(dir, { build: ['compile'] });
      },
    },
    {
      expected: '`scripts.build` must be a string.',
      scenario: 'a value of some other type',
      setup: (dir: string) => writeScripts(dir, { build: 7 }),
    },
  ])('rejects $scenario, naming where it belongs', ({ expected, setup }, { tree }) => {
    setup(tree.dir);

    expect(() => resolveScript('build', { build: ['compile'] }, tree.dir, false)).toThrow(expected);
  });

  it('rejects a package.json that does not parse, naming the file', ({ tree }) => {
    fs.writeFileSync(path.join(tree.dir, 'package.json'), '{ not json');

    expect(() => resolveScript('build', { build: ['compile'] }, tree.dir, false)).toThrow(UserError);
  });

  it('rejects a malformed script as a UserError', ({ tree }) => {
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ scripts: { build: ['compile'] } }));

    expect(() => resolveScript('build', { build: ['compile'] }, tree.dir, false)).toThrow(UserError);
  });

  it('falls through to registry when package.json has no matching script', ({ tree }) => {
    fs.writeFileSync(
      path.join(tree.dir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { other: 'echo hi' } }),
    );

    const registry = { test: 'vitest' };
    const result = resolveScript('test', registry, tree.dir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'test' },
      steps: [{ kind: 'opaque', command: 'vitest' }],
    });
  });
});

// Guards against reintroducing the retired on-disk probe: nmr once chose a package's test scripts by looking for a
// `vitest.integration.config.ts`, so the fixture plants exactly that file and asserts it changes nothing.
describe('test command resolution ignores the package contents', () => {
  const expected: Record<string, string> = {
    test: 'pnpm exec vitest --project unit --project tool',
    'test:all': 'pnpm exec vitest',
    'test:coverage': 'pnpm exec vitest --project unit --project tool --coverage',
    'test:tool': 'pnpm exec vitest --project tool',
    'test:unit': 'pnpm exec vitest --project unit',
    'test:watch': 'pnpm exec vitest --project unit --project tool --watch',
  };

  it('resolves the same six test commands for a bare package', ({ tree }) => {
    const registry = buildWorkspaceRegistry({});

    for (const [command, expectedCommand] of Object.entries(expected)) {
      expect(resolveScript(command, registry, tree.dir, false)).toStrictEqual({
        origin: { tier: 'registry', key: command },
        steps: [{ kind: 'opaque', command: expectedCommand }],
      });
    }
  });

  it('resolves the same six test commands when the retired variant config is present', ({ tree }) => {
    fs.writeFileSync(path.join(tree.dir, 'vitest.integration.config.ts'), '');
    fs.writeFileSync(path.join(tree.dir, 'vitest.standalone.config.ts'), '');
    const registry = buildWorkspaceRegistry({});

    for (const [command, expectedCommand] of Object.entries(expected)) {
      expect(resolveScript(command, registry, tree.dir, false)).toStrictEqual({
        origin: { tier: 'registry', key: command },
        steps: [{ kind: 'opaque', command: expectedCommand }],
      });
    }
  });
});

// region | Helpers

/** Writes a `package.json` carrying `scripts` as given, malformed values included. */
function writeScripts(dir: string, scripts: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test-pkg', scripts }));
}

// endregion | Helpers
