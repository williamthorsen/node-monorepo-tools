import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import collection from '../release-kit.ts';

const [checklist] = collection.checklists;
const checks = checklist.checks;

/** Find a check by name prefix. */
function findCheck(prefix: string) {
  const check = checks.find((c) => c.name.startsWith(prefix));
  if (!check) throw new Error(`No check found with prefix "${prefix}"`);
  return check;
}

let tempDir: string;
let cwdSpy: MockInstance;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'preflight-release-kit-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
});

/** Write a package.json to the temp directory. */
function writePackageJson(content: Record<string, unknown>): void {
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify(content));
}

describe('@williamthorsen/release-kit in devDependencies', () => {
  const check = findCheck('@williamthorsen/release-kit in devDependencies');

  it('passes when release-kit is in devDependencies', () => {
    writePackageJson({ devDependencies: { '@williamthorsen/release-kit': '^4.4.0' } });

    expect(check.check()).toBe(true);
  });

  it('fails when release-kit is not in devDependencies', () => {
    writePackageJson({ devDependencies: {} });

    expect(check.check()).toBe(false);
  });

  it('fails when package.json is missing', () => {
    expect(check.check()).toBe(false);
  });
});

describe('@williamthorsen/release-kit >= minimum version', () => {
  const check = findCheck('@williamthorsen/release-kit >=');

  it('passes when version meets minimum', () => {
    writePackageJson({ devDependencies: { '@williamthorsen/release-kit': '^4.4.0' } });

    expect(check.check()).toBe(true);
  });

  it('fails when version is below minimum', () => {
    writePackageJson({ devDependencies: { '@williamthorsen/release-kit': '^1.0.0' } });

    expect(check.check()).toBe(false);
  });

  it('passes when using workspace: protocol (exempt)', () => {
    writePackageJson({ devDependencies: { '@williamthorsen/release-kit': 'workspace:*' } });

    expect(check.check()).toBe(true);
  });
});

describe('release.yaml workflow exists', () => {
  const check = findCheck('release.yaml workflow exists');

  it('passes when file exists', () => {
    mkdirSync(join(tempDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tempDir, '.github/workflows/release.yaml'), 'name: Release\n');

    expect(check.check()).toBe(true);
  });

  it('fails when file is missing', () => {
    expect(check.check()).toBe(false);
  });
});

describe('release workflow references release.reusable.yaml', () => {
  const check = findCheck('release workflow references');

  it('passes when workflow references the reusable workflow via remote path', () => {
    mkdirSync(join(tempDir, '.github/workflows'), { recursive: true });
    writeFileSync(
      join(tempDir, '.github/workflows/release.yaml'),
      'uses: williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@release-workflow-v1\n',
    );

    expect(check.check()).toBe(true);
  });

  it('passes when workflow references the reusable workflow via local path', () => {
    mkdirSync(join(tempDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tempDir, '.github/workflows/release.yaml'), 'uses: ./.github/workflows/release.reusable.yaml\n');

    expect(check.check()).toBe(true);
  });

  it('fails when workflow does not reference the reusable workflow', () => {
    mkdirSync(join(tempDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tempDir, '.github/workflows/release.yaml'), 'name: Release\n');

    expect(check.check()).toBe(false);
  });
});

describe('publish.yaml workflow exists', () => {
  const check = findCheck('publish.yaml workflow exists');

  it('passes when file exists', () => {
    mkdirSync(join(tempDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tempDir, '.github/workflows/publish.yaml'), 'name: Publish\n');

    expect(check.check()).toBe(true);
  });

  it('fails when file is missing', () => {
    expect(check.check()).toBe(false);
  });
});

describe('publish workflow references publish.reusable.yaml', () => {
  const check = findCheck('publish workflow references');

  it('passes when workflow references the reusable workflow via remote path', () => {
    mkdirSync(join(tempDir, '.github/workflows'), { recursive: true });
    writeFileSync(
      join(tempDir, '.github/workflows/publish.yaml'),
      'uses: williamthorsen/node-monorepo-tools/.github/workflows/publish.reusable.yaml@publish-workflow-v1\n',
    );

    expect(check.check()).toBe(true);
  });

  it('passes when workflow references the reusable workflow via local path', () => {
    mkdirSync(join(tempDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tempDir, '.github/workflows/publish.yaml'), 'uses: ./.github/workflows/publish.reusable.yaml\n');

    expect(check.check()).toBe(true);
  });

  it('fails when workflow does not reference the reusable workflow', () => {
    mkdirSync(join(tempDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tempDir, '.github/workflows/publish.yaml'), 'name: Publish\n');

    expect(check.check()).toBe(false);
  });
});

describe('config does not use removed tagPrefix', () => {
  const check = findCheck('config does not use removed tagPrefix');

  it('is skipped when config file is absent', () => {
    expect(check.skip?.()).toBe('no release-kit config file');
  });

  it('is not skipped when config file exists', () => {
    mkdirSync(join(tempDir, '.config'), { recursive: true });
    writeFileSync(join(tempDir, '.config/release-kit.config.ts'), 'export default {};\n');

    expect(check.skip?.()).toBe(false);
  });

  it('passes when config does not contain tagPrefix', () => {
    mkdirSync(join(tempDir, '.config'), { recursive: true });
    writeFileSync(
      join(tempDir, '.config/release-kit.config.ts'),
      'export default { components: [{ dir: "packages/core" }] };\n',
    );

    expect(check.check()).toBe(true);
  });

  it('fails when config contains tagPrefix', () => {
    mkdirSync(join(tempDir, '.config'), { recursive: true });
    writeFileSync(
      join(tempDir, '.config/release-kit.config.ts'),
      'export default { components: [{ dir: "packages/core", tagPrefix: "core-v" }] };\n',
    );

    expect(check.check()).toBe(false);
  });
});

describe('git-cliff not in devDependencies', () => {
  const check = findCheck('git-cliff not in devDependencies');

  it('passes when git-cliff is not in devDependencies', () => {
    writePackageJson({ devDependencies: {} });

    expect(check.check()).toBe(true);
  });

  it('passes when package.json is missing', () => {
    expect(check.check()).toBe(true);
  });

  it('fails when git-cliff is in devDependencies', () => {
    writePackageJson({ devDependencies: { 'git-cliff': '^1.0.0' } });

    expect(check.check()).toBe(false);
  });
});
