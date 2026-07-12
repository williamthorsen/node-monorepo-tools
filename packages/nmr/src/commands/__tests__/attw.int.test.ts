import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runAttw } from '../attw.ts';

// attw is a root devDependency; skip these when its binary isn't linked (e.g. a bare `vitest` run
// outside the pnpm-populated PATH) rather than reporting the missing-binary path as a failure.
const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..');
const ATTW_BIN = path.join(MONOREPO_ROOT, 'node_modules', '.bin', 'attw');
const attwAvailable = existsSync(ATTW_BIN);

function collect(stream: PassThrough): () => string {
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
  });
  return () => buffer;
}

describe.skipIf(!attwAvailable)('runAttw (integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nmr-attw-int-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePackage(files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), content);
    }
  }

  /**
   * Writes a package of `entryPointCount` entry points, each shipping types alongside an ESM entry point
   * whose body is CommonJS — a real attw failure on every entry point. attw's JSON carries the full
   * resolution tree per entry point, so the payload grows ~18 KB per entry point.
   */
  function writeFailingPackage(name: string, entryPointCount: number): void {
    const exports: Record<string, { types: string; default: string }> = {};
    const files: Record<string, string> = {};
    for (let index = 0; index < entryPointCount; index += 1) {
      const subpath = index === 0 ? '.' : `./e${index}`;
      const base = index === 0 ? 'index' : `e${index}`;
      exports[subpath] = { types: `./${base}.d.ts`, default: `./${base}.js` };
      files[`${base}.js`] = 'module.exports.value = 1;\n';
      files[`${base}.d.ts`] = 'export declare const value: number;\n';
    }
    writePackage({
      'package.json': JSON.stringify({ name, version: '1.0.0', type: 'module', exports }),
      ...files,
    });
  }

  function run(argv: string[]): { exitCode: number; out: string; err: string } {
    const stdout = new PassThrough();
    const readOut = collect(stdout);
    const stderr = new PassThrough();
    const readErr = collect(stderr);
    const exitCode = runAttw({ packageDir: dir, argv, stdout, stderr, env: process.env });
    return { exitCode, out: readOut(), err: readErr() };
  }

  it('passes a well-typed ESM package with a terse line and no leftover tarball', () => {
    writePackage({
      'package.json': JSON.stringify({
        name: 'good-pkg',
        version: '1.0.0',
        type: 'module',
        exports: { '.': { types: './index.d.ts', import: './index.js' } },
      }),
      'index.js': 'export const value = 1;\n',
      'index.d.ts': 'export declare const value: number;\n',
    });

    const { exitCode, out } = run(['--no-definitely-typed']);

    expect(exitCode).toBe(0);
    expect(out).toContain('✓ good-pkg: types OK');
    expect(readdirSync(dir).some((file) => file.endsWith('.tgz'))).toBe(false);
  }, 30_000);

  it('condenses a genuine failure to a terse verdict pointing at --verbose, with no leftover tarball', () => {
    writeFailingPackage('bad-pkg', 1);

    const { exitCode, out } = run(['--no-definitely-typed']);

    expect(exitCode).not.toBe(0);
    expect(out).toContain('✗ bad-pkg —');
    expect(out).toContain('Run `nmr attw --verbose`');
    // The condensed verdict must not dump attw's raw JSON or its full per-subpath firehose.
    expect(out).not.toContain('"analysis"');
    expect(out.trim().split('\n').length).toBeLessThanOrEqual(8);
    expect(readdirSync(dir).some((file) => file.endsWith('.tgz'))).toBe(false);
  }, 30_000);

  it('condenses a package whose JSON exceeds the 64 KiB pipe capacity', () => {
    // attw's JSON branch exits via process.exit(), which truncates an async pipe write at 64 KiB. Five
    // entry points put the payload well past that, so a piped stdout would arrive unparseable and the
    // verdict would silently collapse to the generic fallback.
    writeFailingPackage('big-pkg', 5);

    const { exitCode, out } = run(['--no-definitely-typed']);

    expect(exitCode).not.toBe(0);
    expect(out).toContain('✗ big-pkg —');
    expect(out).not.toContain('attw reported problems');
  }, 60_000);

  it('passes attw full diagnostics through unchanged under --verbose', () => {
    writeFailingPackage('bad-pkg', 1);

    const { exitCode, out, err } = run(['--no-definitely-typed', '--verbose']);

    const combined = out + err;
    expect(exitCode).not.toBe(0);
    expect(combined).toContain('bad-pkg');
    // Raw attw output, not the wrapper's condensed verdict.
    expect(combined).not.toContain('✗ bad-pkg —');
    expect(combined).not.toContain('Run `nmr attw --verbose`');
  }, 30_000);

  it('passes attw output through unchanged when the caller chooses the format', () => {
    writeFailingPackage('bad-pkg', 1);

    const { exitCode, out } = run(['--no-definitely-typed', '--format', 'json']);

    expect(exitCode).not.toBe(0);
    // The caller asked attw for JSON, so they get attw's JSON — not the wrapper's condensed verdict.
    expect(out).toContain('"analysis"');
    expect(out).not.toContain('✗ bad-pkg —');
  }, 30_000);
});
