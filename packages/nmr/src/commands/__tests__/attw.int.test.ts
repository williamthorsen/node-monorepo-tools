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
    const stdout = new PassThrough();
    const readOut = collect(stdout);

    const exitCode = runAttw({
      packageDir: dir,
      argv: ['--no-definitely-typed'],
      stdout,
      stderr: new PassThrough(),
      env: process.env,
    });

    expect(exitCode).toBe(0);
    expect(readOut()).toContain('✓ good-pkg: types OK');
    expect(readdirSync(dir).some((file) => file.endsWith('.tgz'))).toBe(false);
  }, 30_000);

  it('fails a package whose types are genuinely wrong, printing diagnostics and no leftover tarball', () => {
    // The package declares `exports` (so it is not skipped) and ships types, but the ESM entry point
    // contains CommonJS syntax — a real attw failure (UnexpectedModuleSyntax), distinct both from the
    // no-entry-point skip case and from "no types"/"missing file", which attw treats as exit 0.
    writePackage({
      'package.json': JSON.stringify({
        name: 'bad-pkg',
        version: '1.0.0',
        type: 'module',
        exports: { '.': { types: './index.d.ts', default: './index.js' } },
      }),
      'index.js': 'module.exports.value = 1;\n',
      'index.d.ts': 'export declare const value: number;\n',
    });
    const stdout = new PassThrough();
    const readOut = collect(stdout);
    const stderr = new PassThrough();
    const readErr = collect(stderr);

    const exitCode = runAttw({ packageDir: dir, argv: ['--no-definitely-typed'], stdout, stderr, env: process.env });

    expect(exitCode).not.toBe(0);
    expect(readOut() + readErr()).not.toBe('');
    expect(readdirSync(dir).some((file) => file.endsWith('.tgz'))).toBe(false);
  }, 30_000);
});
