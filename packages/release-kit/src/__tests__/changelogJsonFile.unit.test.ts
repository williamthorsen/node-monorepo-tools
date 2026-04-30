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
