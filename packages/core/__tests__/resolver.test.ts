import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRootRegistry,
  buildWorkspaceRegistry,
  describeScript,
  expandScript,
  resolveScript,
} from '../src/resolver.js';

describe('expandScript', () => {
  it('returns a string script unchanged', () => {
    expect(expandScript('vitest')).toBe('vitest');
  });

  it('expands an array to chained nmr invocations', () => {
    expect(expandScript(['compile', 'generate-typings'])).toBe('nmr compile && nmr generate-typings');
  });

  it('expands a single-element array', () => {
    expect(expandScript(['test'])).toBe('nmr test');
  });
});

describe('describeScript', () => {
  it('describes a string script as itself', () => {
    expect(describeScript('vitest --coverage')).toBe('vitest --coverage');
  });

  it('describes an array script with brackets', () => {
    expect(describeScript(['compile', 'generate-typings'])).toBe('[compile, generate-typings]');
  });
});

describe('buildWorkspaceRegistry', () => {
  it('merges config overrides on top of defaults', () => {
    const registry = buildWorkspaceRegistry(
      { workspaceScripts: { 'copy-content': 'tsx scripts/copy-content.ts' } },
      false,
    );

    expect(registry['copy-content']).toBe('tsx scripts/copy-content.ts');
    expect(registry['build']).toEqual(['compile', 'generate-typings']);
  });

  it('allows config to override default scripts', () => {
    const registry = buildWorkspaceRegistry({ workspaceScripts: { clean: 'rm -rf dist' } }, false);

    expect(registry['clean']).toBe('rm -rf dist');
  });
});

describe('buildRootRegistry', () => {
  it('merges config overrides on top of defaults', () => {
    const registry = buildRootRegistry({
      rootScripts: { 'demo:catwalk': 'pnpx http-server --port=5189' },
    });

    expect(registry['demo:catwalk']).toBe('pnpx http-server --port=5189');
    expect(registry['ci']).toEqual(['check:strict', 'build']);
  });
});

describe('resolveScript', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('resolves from the registry when no package override exists', () => {
    const registry = { test: 'vitest' };
    const result = resolveScript('test', registry);

    expect(result).toEqual({ command: 'vitest', source: 'default' });
  });

  it('expands array scripts from the registry', () => {
    const registry = { build: ['compile', 'generate-typings'] };
    const result = resolveScript('build', registry);

    expect(result).toEqual({
      command: 'nmr compile && nmr generate-typings',
      source: 'default',
    });
  });

  it('returns undefined for unknown commands', () => {
    const registry = { test: 'vitest' };
    expect(resolveScript('unknown', registry)).toBeUndefined();
  });

  it('uses package.json override when present (tier 3)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { test: 'jest' } }),
    );

    const registry = { test: 'vitest' };
    const result = resolveScript('test', registry, tmpDir);

    expect(result).toEqual({ command: 'jest', source: 'package' });
  });

  it('skips execution when package.json override is empty string', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-pkg', scripts: { lint: '' } }));

    const registry = { lint: 'eslint .' };
    const result = resolveScript('lint', registry, tmpDir);

    expect(result).toEqual({ command: '', source: 'package' });
  });

  it('falls through to registry when package.json has no matching script', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', scripts: { other: 'echo hi' } }),
    );

    const registry = { test: 'vitest' };
    const result = resolveScript('test', registry, tmpDir);

    expect(result).toEqual({ command: 'vitest', source: 'default' });
  });
});
