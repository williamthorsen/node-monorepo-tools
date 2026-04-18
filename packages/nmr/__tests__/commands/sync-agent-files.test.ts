import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { check, parseSourceStamp, sync } from '../../src/commands/sync-agent-files.js';
import { VERSION } from '../../src/version.js';

const DESTINATION_RELATIVE_PATH = '.agents/nmr/AGENTS.md';
const currentStamp = `@williamthorsen/nmr@${VERSION}`;

describe('parseSourceStamp', () => {
  it('extracts source value from well-formed frontmatter', () => {
    const content = `---\nsource: '@williamthorsen/nmr@1.2.3'\n---\nbody\n`;
    expect(parseSourceStamp(content)).toBe('@williamthorsen/nmr@1.2.3');
  });

  it('returns null when frontmatter is missing', () => {
    expect(parseSourceStamp('# just a heading\n')).toBeNull();
  });

  it('returns null when frontmatter has no source field', () => {
    const content = `---\nother: value\n---\nbody\n`;
    expect(parseSourceStamp(content)).toBeNull();
  });

  it('accepts a double-quoted source value', () => {
    const content = `---\nsource: "@williamthorsen/nmr@1.2.3"\n---\nbody\n`;
    expect(parseSourceStamp(content)).toBe('@williamthorsen/nmr@1.2.3');
  });
});

describe('sync', () => {
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
    expect(result.written).toBe(destination);
    expect(result.stamp).toBe(currentStamp);

    const written = fs.readFileSync(destination, 'utf8');
    expect(written.startsWith(`---\nsource: '${currentStamp}'\n---\n`)).toBe(true);
    expect(written).toContain('# nmr: agent guidance');
    expect(written).not.toContain('0.0.0-source');
  });

  it('creates the .agents/nmr directory when absent', () => {
    expect(fs.existsSync(path.join(tmpDir, '.agents'))).toBe(false);
    sync(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.agents', 'nmr'))).toBe(true);
  });

  it('overwrites an existing destination with a stale stamp', () => {
    const destination = path.join(tmpDir, DESTINATION_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `---\nsource: '@williamthorsen/nmr@0.0.1-stale'\n---\nold body\n`);

    sync(tmpDir);

    const written = fs.readFileSync(destination, 'utf8');
    expect(written).toContain(currentStamp);
    expect(written).not.toContain('0.0.1-stale');
    expect(written).not.toContain('old body');
  });
});

describe('check', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-agent-files-check-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ok when the destination matches the installed version', () => {
    sync(tmpDir);
    const result = check(tmpDir);
    expect(result.ok).toBe(true);
  });

  it('returns a missing-file reason when the destination does not exist', () => {
    const result = check(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('.agents/nmr/AGENTS.md is missing');
      expect(result.reason).toContain('nmr sync-agent-files');
    }
  });

  it('returns a malformed-frontmatter reason when the stamp cannot be parsed', () => {
    const destination = path.join(tmpDir, DESTINATION_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, 'no frontmatter here\n');

    const result = check(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Cannot parse version stamp');
      expect(result.reason).toContain('nmr sync-agent-files');
    }
  });

  it('returns an out-of-sync reason when the stamp does not match', () => {
    const destination = path.join(tmpDir, DESTINATION_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `---\nsource: '@williamthorsen/nmr@99.99.99'\n---\nbody\n`);

    const result = check(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('out of sync');
      expect(result.reason).toContain('99.99.99');
      expect(result.reason).toContain(currentStamp);
    }
  });
});
