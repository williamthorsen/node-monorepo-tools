import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveChangelogJsonPath, upsertChangelogJson, writeChangelogJson } from '../changelogJsonFile.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import type { ChangelogEntry } from '../types.ts';

describe(resolveChangelogJsonPath, () => {
  it('joins the changelog path with the config-supplied output path', () => {
    const config = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, outputPath: '.meta/changelog.json' } };
    expect(resolveChangelogJsonPath(config, 'packages/arrays')).toBe('packages/arrays/.meta/changelog.json');
  });

  it('honours a custom outputPath', () => {
    const config = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, outputPath: 'docs/changelog.json' } };
    expect(resolveChangelogJsonPath(config, '.')).toBe('docs/changelog.json');
  });
});

describe(writeChangelogJson, () => {
  let tempDir: string;
  let outputPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-write-changelog-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    outputPath = join(tempDir, '.meta', 'changelog.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes entries sorted newest-first', () => {
    const entries: ChangelogEntry[] = [
      { version: '0.9.0', date: '2024-01-01', sections: [] },
      { version: '1.1.0', date: '2024-03-01', sections: [] },
      { version: '1.0.0', date: '2024-02-01', sections: [] },
    ];

    writeChangelogJson(outputPath, entries);

    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written.map((e) => e.version)).toStrictEqual(['1.1.0', '1.0.0', '0.9.0']);
  });

  it('overwrites existing file content unconditionally without reading', () => {
    // Pre-populate with a valid file. After writeChangelogJson, the file must contain ONLY the
    // new entries — preserving existing entries is the upsert path's responsibility.
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    const existing: ChangelogEntry[] = [{ version: '0.5.0', date: '2024-01-01', sections: [] }];
    writeFileSync(outputPath, JSON.stringify(existing), 'utf8');

    const fresh: ChangelogEntry[] = [{ version: '1.0.0', date: '2024-02-01', sections: [] }];
    writeChangelogJson(outputPath, fresh);

    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written).toHaveLength(1);
    expect(written[0]?.version).toBe('1.0.0');
  });

  it('does not warn or throw when the existing file is unparseable (because it is not read)', () => {
    // Pin: writeChangelogJson MUST NOT exercise the parse-failure soft path. The malformed
    // existing file is overwritten without warning — this is the project-stage no-read
    // behavior structurally enforced by writeChangelogJson.
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    writeFileSync(outputPath, '{invalid json', 'utf8');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fresh: ChangelogEntry[] = [{ version: '1.0.0', date: '2024-02-01', sections: [] }];
    writeChangelogJson(outputPath, fresh);

    expect(warnSpy).not.toHaveBeenCalled();
    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written).toHaveLength(1);
    expect(written[0]?.version).toBe('1.0.0');
  });

  it('creates parent directories when missing', () => {
    const nested = join(tempDir, 'a', 'b', 'c', 'changelog.json');
    writeChangelogJson(nested, [{ version: '1.0.0', date: '2024-01-01', sections: [] }]);
    expect(existsSync(nested)).toBe(true);
  });

  it('emits compact-stringify formatting with a trailing newline', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] }],
      },
    ];
    writeChangelogJson(outputPath, entries);

    const content = readFileSync(outputPath, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    // Round-trips through JSON.parse to the same shape.
    expect(JSON.parse(content)).toStrictEqual(entries);
  });

  it('returns the file path written', () => {
    const result = writeChangelogJson(outputPath, [{ version: '1.0.0', date: '2024-01-01', sections: [] }]);
    expect(result).toBe(outputPath);
  });
});

describe('writeChangelogJson — version sort semantics', () => {
  let tempDir: string;
  let outputPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-sort-changelog-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    outputPath = join(tempDir, '.meta', 'changelog.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeAndReadVersions(versions: string[]): string[] {
    const entries: ChangelogEntry[] = versions.map((version) => ({ version, date: '2024-01-01', sections: [] }));
    writeChangelogJson(outputPath, entries);
    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    return written.map((e) => e.version);
  }

  it('orders releases by SemVer numeric precedence, not lexical (1.10.0 > 1.2.0)', () => {
    expect(writeAndReadVersions(['1.2.0', '0.9.0', '1.10.0'])).toStrictEqual(['1.10.0', '1.2.0', '0.9.0']);
  });

  it('places a prerelease before its corresponding release per SemVer §11', () => {
    expect(writeAndReadVersions(['1.2.3-alpha', '1.2.3-rc.1', '1.2.3'])).toStrictEqual([
      '1.2.3',
      '1.2.3-rc.1',
      '1.2.3-alpha',
    ]);
  });

  it('orders same-base prereleases lexically (alpha < beta)', () => {
    expect(writeAndReadVersions(['1.2.3-beta', '1.2.3-alpha'])).toStrictEqual(['1.2.3-beta', '1.2.3-alpha']);
  });

  it('compares numeric prerelease identifiers numerically (rc.10 > rc.2)', () => {
    expect(writeAndReadVersions(['1.2.3-rc.2', '1.2.3-rc.10'])).toStrictEqual(['1.2.3-rc.10', '1.2.3-rc.2']);
  });

  it('ignores build metadata for ordering — build-metadata variants of the same version rank equally', () => {
    const result = writeAndReadVersions(['1.0.0', '1.2.3+build.2', '1.2.3+build.1', '0.9.0']);
    // Both 1.2.3+build.* versions outrank 1.0.0 and 0.9.0 and stay together (their order
    // relative to each other is implementation-defined; stable sort preserves input order).
    expect(result.slice(2)).toStrictEqual(['1.0.0', '0.9.0']);
    expect(new Set(result.slice(0, 2))).toStrictEqual(new Set(['1.2.3+build.1', '1.2.3+build.2']));
  });

  it('sorts a single malformed version to the bottom', () => {
    expect(writeAndReadVersions(['1.0.0', 'garbage', '1.2.3'])).toStrictEqual(['1.2.3', '1.0.0', 'garbage']);
  });

  it('orders multiple malformed versions lexically descending at the bottom', () => {
    expect(writeAndReadVersions(['aaa', '1.0.0', 'zzz'])).toStrictEqual(['1.0.0', 'zzz', 'aaa']);
  });
});

describe(upsertChangelogJson, () => {
  let tempDir: string;
  let outputPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-upsert-changelog-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    outputPath = join(tempDir, '.meta', 'changelog.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('preserves an existing entry whose version is absent from the new entries', () => {
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    const existing: ChangelogEntry[] = [
      {
        version: '0.9.0',
        date: '2024-01-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Old feature' }] }],
      },
    ];
    writeFileSync(outputPath, JSON.stringify(existing), 'utf8');

    const fresh: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-02-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'New feature' }] }],
      },
    ];
    upsertChangelogJson(outputPath, fresh);

    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written.map((e) => e.version)).toStrictEqual(['1.0.0', '0.9.0']);
  });

  it('replaces an existing entry whose version matches the new entry', () => {
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    const existing: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Original' }] }],
      },
    ];
    writeFileSync(outputPath, JSON.stringify(existing), 'utf8');

    const fresh: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-02-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Replaced' }] }],
      },
    ];
    upsertChangelogJson(outputPath, fresh);

    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written).toHaveLength(1);
    expect(written[0]?.sections[0]?.items[0]?.description).toBe('Replaced');
    expect(written[0]?.date).toBe('2024-02-01');
  });

  it('sorts merged entries newest-first', () => {
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    const existing: ChangelogEntry[] = [{ version: '0.9.0', date: '2024-01-01', sections: [] }];
    writeFileSync(outputPath, JSON.stringify(existing), 'utf8');

    upsertChangelogJson(outputPath, [{ version: '1.0.0', date: '2024-02-01', sections: [] }]);

    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written.map((e) => e.version)).toStrictEqual(['1.0.0', '0.9.0']);
  });

  it('warns and treats the existing file as empty when it cannot be parsed', () => {
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    writeFileSync(outputPath, '{invalid json', 'utf8');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    upsertChangelogJson(outputPath, [{ version: '1.0.0', date: '2024-02-01', sections: [] }]);

    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written).toHaveLength(1);
    expect(written[0]?.version).toBe('1.0.0');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not parse existing'));
  });

  it('writes new entries when the existing file is missing', () => {
    upsertChangelogJson(outputPath, [{ version: '1.0.0', date: '2024-01-01', sections: [] }]);

    const written: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written).toHaveLength(1);
    expect(written[0]?.version).toBe('1.0.0');
  });

  it('emits compact-stringify formatting with a trailing newline', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] }],
      },
    ];
    upsertChangelogJson(outputPath, entries);

    const content = readFileSync(outputPath, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(JSON.parse(content)).toStrictEqual(entries);
  });

  it('returns the file path written', () => {
    const result = upsertChangelogJson(outputPath, [{ version: '1.0.0', date: '2024-01-01', sections: [] }]);
    expect(result).toBe(outputPath);
  });
});
