import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import collection from '../nmr.ts';

const [checklist] = collection.checklists;

/** Search nested checks recursively for a check matching a name prefix. */
function searchChecks(prefix: string, checks: typeof checklist.checks): (typeof checks)[number] | undefined {
  for (const check of checks) {
    if (check.name.startsWith(prefix)) return check;
    if (check.checks) {
      const found = searchChecks(prefix, check.checks);
      if (found) return found;
    }
  }
  return undefined;
}

/** Find a check by name prefix, throwing if not found. */
function findCheck(prefix: string) {
  const check = searchChecks(prefix, checklist.checks);
  if (!check) throw new Error(`No check found with prefix "${prefix}"`);
  return check;
}

let tempDir: string;
let cwdSpy: MockInstance;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'preflight-nmr-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
});

/** Write a package.json to the temp directory. */
function writePackageJson(content: Record<string, unknown>): void {
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify(content));
}

describe('@williamthorsen/nmr in devDependencies', () => {
  const check = findCheck('@williamthorsen/nmr in devDependencies');

  it('passes when nmr is in devDependencies', () => {
    writePackageJson({ devDependencies: { '@williamthorsen/nmr': '^0.9.0' } });

    expect(check.check()).toBe(true);
  });

  it('fails when nmr is not in devDependencies', () => {
    writePackageJson({ devDependencies: {} });

    expect(check.check()).toBe(false);
  });

  it('fails when package.json is missing', () => {
    expect(check.check()).toBe(false);
  });
});

describe('@williamthorsen/nmr >= minimum version', () => {
  const check = findCheck('@williamthorsen/nmr >=');

  it('passes when version meets minimum', () => {
    writePackageJson({ devDependencies: { '@williamthorsen/nmr': '^0.9.0' } });

    expect(check.check()).toBe(true);
  });

  it('fails when version is below minimum', () => {
    writePackageJson({ devDependencies: { '@williamthorsen/nmr': '^0.1.0' } });

    expect(check.check()).toBe(false);
  });

  it('passes when using workspace: protocol (exempt)', () => {
    writePackageJson({ devDependencies: { '@williamthorsen/nmr': 'workspace:*' } });

    expect(check.check()).toBe(true);
  });
});

describe('pnpm-workspace.yaml exists', () => {
  const check = findCheck('pnpm-workspace.yaml');

  it('passes when file exists', () => {
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');

    expect(check.check()).toBe(true);
  });

  it('fails when file is missing', () => {
    expect(check.check()).toBe(false);
  });
});

describe('package.json has packageManager field', () => {
  const check = findCheck('package.json has packageManager');

  it('passes when field is present', () => {
    writePackageJson({ packageManager: 'pnpm@10.33.0' });

    expect(check.check()).toBe(true);
  });

  it('fails when field is missing', () => {
    writePackageJson({ name: 'test' });

    expect(check.check()).toBe(false);
  });
});

describe('.tool-versions does not list pnpm', () => {
  const check = findCheck('.tool-versions does not list pnpm');

  it('passes when file is absent', () => {
    expect(check.check()).toBe(true);
  });

  it('passes when file exists without pnpm', () => {
    writeFileSync(join(tempDir, '.tool-versions'), 'nodejs 22.0.0\n');

    expect(check.check()).toBe(true);
  });

  it('fails when file lists pnpm', () => {
    writeFileSync(join(tempDir, '.tool-versions'), 'nodejs 22.0.0\npnpm 10.0.0\n');

    expect(check.check()).toBe(false);
  });
});

describe('.config/nmr.config.ts uses defineConfig', () => {
  const check = findCheck('.config/nmr.config.ts uses defineConfig');

  it('is skipped when config file is absent', () => {
    expect(check.skip?.()).toBe('no nmr config file');
  });

  it('is not skipped when config file exists', () => {
    mkdirSync(join(tempDir, '.config'), { recursive: true });
    writeFileSync(join(tempDir, '.config/nmr.config.ts'), 'export default defineConfig({});\n');

    expect(check.skip?.()).toBe(false);
  });

  it('passes when config file uses defineConfig', () => {
    mkdirSync(join(tempDir, '.config'), { recursive: true });
    writeFileSync(
      join(tempDir, '.config/nmr.config.ts'),
      'import { defineConfig } from "@williamthorsen/nmr";\nexport default defineConfig({});\n',
    );

    expect(check.check()).toBe(true);
  });

  it('fails when config file does not use defineConfig', () => {
    mkdirSync(join(tempDir, '.config'), { recursive: true });
    writeFileSync(join(tempDir, '.config/nmr.config.ts'), 'export default {};\n');

    expect(check.check()).toBe(false);
  });
});
