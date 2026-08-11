import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyDevBin,
  buildRootRegistry,
  buildWorkspaceRegistry,
  describeScript,
  expandScript,
  resolveScript,
} from '../resolver.ts';
import { UserError } from '../UserError.ts';

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
});

describe(describeScript, () => {
  it('describes a string script as itself', () => {
    expect(describeScript('vitest --coverage')).toBe('vitest --coverage');
  });

  it('describes an array script with brackets', () => {
    expect(describeScript(['fmt', 'lint'])).toBe('[fmt, lint]');
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
      ci: ['build', 'check:strict'],
      'demo:catwalk': 'pnpx http-server --port=5189',
    });
  });
});

describe(resolveScript, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

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

  it('does not treat an `Object.prototype` member as a package.json override', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { test: 'jest' } }),
    );

    expect(resolveScript('constructor', { test: 'vitest' }, tmpDir, false)).toBeUndefined();
  });

  it('uses package.json override when present (tier 3)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { test: 'jest' } }),
    );

    const registry = { test: 'vitest' };
    const result = resolveScript('test', registry, tmpDir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'package', file: path.join(tmpDir, 'package.json'), key: 'test' },
      steps: [{ kind: 'opaque', command: 'jest' }],
    });
  });

  it('does not rewrite tier-3 override strings when workspaceRoot is true', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { build: 'nmr compile' } }),
    );

    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, tmpDir, true);

    // User-authored override strings pass through untouched; only generated
    // chains receive the -w flag.
    expect(result).toStrictEqual({
      origin: { tier: 'package', file: path.join(tmpDir, 'package.json'), key: 'build' },
      steps: [{ kind: 'opaque', command: 'nmr compile' }],
    });
  });

  it('skips execution when package.json override is empty string', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-pkg', scripts: { lint: '' } }));

    const registry = { lint: 'eslint .' };
    const result = resolveScript('lint', registry, tmpDir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'package', file: path.join(tmpDir, 'package.json'), key: 'lint' },
      steps: [{ kind: 'opaque', command: '' }],
    });
  });

  it('skips self-referential package.json override (exact match)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { build: 'nmr build' } }),
    );

    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, tmpDir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'build' },
      steps: [
        { kind: 'structural', argv: ['nmr', 'fmt'] },
        { kind: 'structural', argv: ['nmr', 'lint'] },
      ],
    });
  });

  it('skips self-referential package.json override (with trailing args)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { build: 'nmr build --verbose' } }),
    );

    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, tmpDir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'build' },
      steps: [
        { kind: 'structural', argv: ['nmr', 'fmt'] },
        { kind: 'structural', argv: ['nmr', 'lint'] },
      ],
    });
  });

  it('does not skip non-self-referential nmr override', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { build: 'nmr compile' } }),
    );

    const registry = { build: ['fmt', 'lint'] };
    const result = resolveScript('build', registry, tmpDir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'package', file: path.join(tmpDir, 'package.json'), key: 'build' },
      steps: [{ kind: 'opaque', command: 'nmr compile' }],
    });
  });

  it.each([
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
  ])('rejects $scenario, naming where it belongs', ({ expected, setup }) => {
    setup(tmpDir);

    expect(() => resolveScript('build', { build: ['compile'] }, tmpDir, false)).toThrow(expected);
  });

  it('rejects a package.json that does not parse, naming the file', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ not json');

    expect(() => resolveScript('build', { build: ['compile'] }, tmpDir, false)).toThrow(UserError);
  });

  it('rejects a malformed script as a UserError', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ scripts: { build: ['compile'] } }));

    expect(() => resolveScript('build', { build: ['compile'] }, tmpDir, false)).toThrow(UserError);
  });

  it('falls through to registry when package.json has no matching script', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { other: 'echo hi' } }),
    );

    const registry = { test: 'vitest' };
    const result = resolveScript('test', registry, tmpDir, false);

    expect(result).toStrictEqual({
      origin: { tier: 'registry', key: 'test' },
      steps: [{ kind: 'opaque', command: 'vitest' }],
    });
  });
});

// Guards against reintroducing the retired on-disk probe: nmr once chose a package's test scripts by looking for a
// `vitest.integration.config.ts`, so the fixture plants exactly that file and asserts it changes nothing.
describe('test command resolution ignores the package contents', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  const expected: Record<string, string> = {
    test: 'pnpm exec vitest --project unit --project tool',
    'test:all': 'pnpm exec vitest',
    'test:coverage': 'pnpm exec vitest --project unit --project tool --coverage',
    'test:tool': 'pnpm exec vitest --project tool',
    'test:unit': 'pnpm exec vitest --project unit',
    'test:watch': 'pnpm exec vitest --project unit --project tool --watch',
  };

  it('resolves the same six test commands for a bare package', () => {
    const registry = buildWorkspaceRegistry({});

    for (const [command, expectedCommand] of Object.entries(expected)) {
      expect(resolveScript(command, registry, tmpDir, false)).toStrictEqual({
        origin: { tier: 'registry', key: command },
        steps: [{ kind: 'opaque', command: expectedCommand }],
      });
    }
  });

  it('resolves the same six test commands when the retired variant config is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'vitest.integration.config.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'vitest.standalone.config.ts'), '');
    const registry = buildWorkspaceRegistry({});

    for (const [command, expectedCommand] of Object.entries(expected)) {
      expect(resolveScript(command, registry, tmpDir, false)).toStrictEqual({
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
