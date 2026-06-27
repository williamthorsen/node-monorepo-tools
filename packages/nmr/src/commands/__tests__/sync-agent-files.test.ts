import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readPackageVersion } from '@williamthorsen/nmr-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { check, sync } from '../sync-agent-files.ts';

const DESTINATION_RELATIVE_PATH = '.agents/nmr/AGENTS.md';
const currentPackageSpecifier = `@williamthorsen/nmr@${readPackageVersion(import.meta.url)}`;
const STALE_PACKAGE_SPECIFIER = '@williamthorsen/nmr@0.0.1-stale';

describe(check, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-agent-files-check-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ok when the body matches the installed version', () => {
    sync(tmpDir);
    expect(check(tmpDir).ok).toBe(true);
  });

  it('returns ok when the body matches but the package specifier is older than installed', () => {
    const destination = path.join(tmpDir, DESTINATION_RELATIVE_PATH);
    sync(tmpDir);
    rewritePackageSpecifier(destination, STALE_PACKAGE_SPECIFIER);

    expect(check(tmpDir).ok).toBe(true);
  });

  it('fails when the body differs even though the package specifier matches installed', () => {
    const destination = path.join(tmpDir, DESTINATION_RELATIVE_PATH);
    sync(tmpDir);
    fs.appendFileSync(destination, '\nlocal edit\n');

    const result = check(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('content is out of date');
      expect(result.reason).toContain('nmr sync-agent-files');
    }
  });

  it('returns a missing-file reason when the destination does not exist', () => {
    const result = check(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('.agents/nmr/AGENTS.md is missing');
      expect(result.reason).toContain('nmr sync-agent-files');
    }
  });
});

describe(sync, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-agent-files-sync-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes destination with fresh frontmatter and source body', () => {
    const result = sync(tmpDir);

    const destination = path.join(tmpDir, DESTINATION_RELATIVE_PATH);
    expect(result.path).toBe(destination);
    expect(result.packageSpecifier).toBe(currentPackageSpecifier);
    expect(result.changed).toBe(true);

    const written = fs.readFileSync(destination, 'utf8');
    expect(written.startsWith(`---\nsource: '${currentPackageSpecifier}'\n---\n`)).toBe(true);
    expect(written).toContain('# nmr: agent guidance');
    expect(written).not.toContain('0.0.0-source');
  });

  it('creates the .agents/nmr directory when absent', () => {
    expect(fs.existsSync(path.join(tmpDir, '.agents'))).toBe(false);
    sync(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.agents', 'nmr'))).toBe(true);
  });

  it('rewrites a destination whose body differs', () => {
    const destination = path.join(tmpDir, DESTINATION_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `---\nsource: '${STALE_PACKAGE_SPECIFIER}'\n---\nold body\n`);

    const result = sync(tmpDir);

    expect(result.changed).toBe(true);
    const written = fs.readFileSync(destination, 'utf8');
    expect(written).toContain(currentPackageSpecifier);
    expect(written).not.toContain('0.0.1-stale');
    expect(written).not.toContain('old body');
  });

  it('does not rewrite when the body already matches, preserving the existing specifier', () => {
    const destination = path.join(tmpDir, DESTINATION_RELATIVE_PATH);
    sync(tmpDir);
    rewritePackageSpecifier(destination, STALE_PACKAGE_SPECIFIER);

    const result = sync(tmpDir);

    expect(result.changed).toBe(false);
    expect(result.path).toBe(destination);
    expect(fs.readFileSync(destination, 'utf8')).toContain(STALE_PACKAGE_SPECIFIER);
  });
});

/** Rewrites the destination's frontmatter package specifier to `specifier`, leaving the body untouched. */
function rewritePackageSpecifier(destination: string, specifier: string): void {
  const content = fs.readFileSync(destination, 'utf8');
  fs.writeFileSync(destination, content.replace(currentPackageSpecifier, specifier));
}
