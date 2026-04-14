import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangelogEntry } from '../types.ts';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const { execFileSync } = await import('node:child_process');
const { createGithubRelease } = await import('../createGithubRelease.ts');

const mockedExecFileSync = vi.mocked(execFileSync);

describe(createGithubRelease, () => {
  let tempDir: string;
  let changelogJsonPath: string;

  const sampleEntries: ChangelogEntry[] = [
    {
      version: '1.0.0',
      date: '2024-11-15',
      sections: [
        { title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] },
        { title: 'CI', audience: 'dev', items: [{ description: 'Update pipeline' }] },
      ],
    },
  ];

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-gh-release-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    changelogJsonPath = join(tempDir, 'changelog.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns false and warns when changelog.json does not exist', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath: join(tempDir, 'nonexistent.json'),
      dryRun: false,
    });
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('returns false and warns when version is not in changelog.json', () => {
    writeFileSync(changelogJsonPath, JSON.stringify(sampleEntries), 'utf8');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = createGithubRelease({
      tag: 'v99.0.0',
      changelogJsonPath,
      dryRun: false,
    });
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no changelog entry'));
  });

  it('logs the command in dry-run mode without executing', () => {
    writeFileSync(changelogJsonPath, JSON.stringify(sampleEntries), 'utf8');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: true,
    });
    expect(result).toBe(true);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
  });

  it('calls gh CLI with correct arguments', () => {
    writeFileSync(changelogJsonPath, JSON.stringify(sampleEntries), 'utf8');

    createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['release', 'create', 'v1.0.0']),
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('passes only all-audience sections in the release notes', () => {
    writeFileSync(changelogJsonPath, JSON.stringify(sampleEntries), 'utf8');

    createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });

    const callArgs = mockedExecFileSync.mock.calls[0];
    const args = callArgs?.[1];
    if (Array.isArray(args)) {
      const notesIndex = args.indexOf('--notes');
      const body = args[notesIndex + 1];
      expect(body).toContain('Features');
      expect(body).not.toContain('CI');
    }
  });

  it('returns false and warns on gh CLI failure', () => {
    writeFileSync(changelogJsonPath, JSON.stringify(sampleEntries), 'utf8');
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error('gh failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to create'));
  });

  it('extracts version from prefixed tags', () => {
    writeFileSync(changelogJsonPath, JSON.stringify(sampleEntries), 'utf8');

    createGithubRelease({
      tag: 'release-kit-v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });

    expect(mockedExecFileSync).toHaveBeenCalled();
  });
});
