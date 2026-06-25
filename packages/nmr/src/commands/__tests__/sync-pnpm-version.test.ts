import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { unindent } from '@williamthorsen/toolbelt.strings/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractPnpmVersion, syncPnpmVersion } from '../sync-pnpm-version.ts';

describe('extractPnpmVersion', () => {
  it('extracts version from pnpm@X.Y.Z format', () => {
    expect(extractPnpmVersion('pnpm@10.32.1')).toBe('10.32.1');
  });

  it('returns null for undefined input', () => {
    expect(extractPnpmVersion(undefined)).toBeNull();
  });

  it('returns null for non-pnpm package manager', () => {
    expect(extractPnpmVersion('npm@9.0.0')).toBeNull();
  });
});

describe('syncPnpmVersion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-sync-test-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it('updates workflow when versions differ', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@10.32.1' }),
    );

    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowDir, 'code-quality.yaml'),
      unindent`
        name: CI
        on: push
        jobs:
          code-quality:
            uses: org/repo/.github/workflows/code-quality-pnpm.yaml@main
            with:
              pnpm-version: 10.30.0
        `,
    );

    syncPnpmVersion(tmpDir);

    const updated = fs.readFileSync(path.join(workflowDir, 'code-quality.yaml'), 'utf8');
    expect(updated).toContain('pnpm-version: 10.32.1');
    expect(updated).not.toContain('10.30.0');
  });

  it('throws when packageManager field is missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));

    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'code-quality.yaml'), 'name: CI\n');

    expect(() => syncPnpmVersion(tmpDir)).toThrow('Could not extract pnpm version');
  });

  it('throws when packageManager is not pnpm', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', packageManager: 'yarn@4.0.0' }));

    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'code-quality.yaml'), 'name: CI\n');

    expect(() => syncPnpmVersion(tmpDir)).toThrow('Could not extract pnpm version');
  });

  it('does not modify workflow when versions match', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@10.32.1' }),
    );

    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    const original = unindent`
      name: CI
      on: push
      jobs:
        code-quality:
          uses: org/repo/.github/workflows/code-quality-pnpm.yaml@main
          with:
            pnpm-version: 10.32.1
      `;
    fs.writeFileSync(path.join(workflowDir, 'code-quality.yaml'), original);

    syncPnpmVersion(tmpDir);

    const content = fs.readFileSync(path.join(workflowDir, 'code-quality.yaml'), 'utf8');
    expect(content).toBe(original);
  });

  it('preserves comments and quote style when updating the version', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@10.32.1' }),
    );

    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowDir, 'code-quality.yaml'),
      unindent`
        # Workflow comment
        name: CI
        on: push
        jobs:
          code-quality:
            uses: org/repo/.github/workflows/code-quality-pnpm.yaml@main
            with:
              pnpm-version: '10.30.0' # pin pnpm
        `,
    );

    syncPnpmVersion(tmpDir);

    const updated = fs.readFileSync(path.join(workflowDir, 'code-quality.yaml'), 'utf8');
    expect(updated).toContain("pnpm-version: '10.32.1'");
    expect(updated).toContain('# Workflow comment');
    expect(updated).toContain('# pin pnpm');
    expect(updated).not.toContain('10.30.0');
  });

  it('updates every pnpm-version occurrence across jobs', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@10.32.1' }),
    );

    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowDir, 'code-quality.yaml'),
      unindent`
        name: CI
        on: push
        jobs:
          code-quality:
            uses: org/repo/.github/workflows/code-quality-pnpm.yaml@main
            with:
              pnpm-version: 10.30.0
          extra:
            uses: org/repo/.github/workflows/other.yaml@main
            with:
              pnpm-version: 10.29.0
        `,
    );

    syncPnpmVersion(tmpDir);

    const updated = fs.readFileSync(path.join(workflowDir, 'code-quality.yaml'), 'utf8');
    expect([...updated.matchAll(/pnpm-version: 10\.32\.1/g)]).toHaveLength(2);
    expect(updated).not.toContain('10.30.0');
    expect(updated).not.toContain('10.29.0');
  });

  it('updates a stale secondary job when the code-quality job is already current', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@10.32.1' }),
    );

    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowDir, 'code-quality.yaml'),
      unindent`
        name: CI
        on: push
        jobs:
          code-quality:
            uses: org/repo/.github/workflows/code-quality-pnpm.yaml@main
            with:
              pnpm-version: 10.32.1
          extra:
            uses: org/repo/.github/workflows/other.yaml@main
            with:
              pnpm-version: 10.30.0
        `,
    );

    syncPnpmVersion(tmpDir);

    const updated = fs.readFileSync(path.join(workflowDir, 'code-quality.yaml'), 'utf8');
    expect([...updated.matchAll(/pnpm-version: 10\.32\.1/g)]).toHaveLength(2);
    expect(updated).not.toContain('10.30.0');
  });

  it('throws a descriptive error when the workflow file has parse errors', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@10.32.1' }),
    );

    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowDir, 'code-quality.yaml'),
      unindent`
        name: CI
        on: push
        on: pull_request
        jobs:
          code-quality:
            with:
              pnpm-version: 10.30.0
        `,
    );

    expect(() => syncPnpmVersion(tmpDir)).toThrow('Failed to parse workflow file');
  });
});
