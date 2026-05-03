import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncWorkTypes } from '../syncWorkTypes.ts';

const FIXTURE_URL = 'https://test.example/work-types.json';

const SAMPLE_DATA = {
  tiers: ['Public', 'Internal', 'Process'],
  types: [
    {
      tier: 'Public',
      key: 'feat',
      aliases: ['feature'],
      emoji: '🎉',
      label: 'Features',
      breakingPolicy: 'optional',
    },
  ],
};

/** Build a `Response`-like object the helper can consume. */
function makeResponse(init: { status: number; statusText?: string; body: string }): Response {
  const responseInit: ResponseInit = {
    status: init.status,
    statusText: init.statusText ?? 'OK',
  };
  return new Response(init.body, responseInit);
}

describe(syncWorkTypes, () => {
  let tempDir: string;
  let localPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'work-types-sync-'));
    localPath = join(tempDir, 'work-types.json');
  });

  afterEach(() => {
    // Restore write permissions so the temp tree can be removed even if a test made it
    // read-only.
    try {
      chmodSync(tempDir, 0o755);
    } catch {
      // tempDir may already be writable; ignore.
    }
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exits 0 when sync writes new content to local', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(SAMPLE_DATA) }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/Synced/);
  });

  it('exits 0 when local already matches upstream', async () => {
    writeFileSync(localPath, `${JSON.stringify(SAMPLE_DATA, null, 2)}\n`, 'utf8');
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(SAMPLE_DATA) }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/already matches/);
  });

  it('exits 2 on a non-OK non-success HTTP status', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 500, statusText: 'Internal Server Error', body: '' }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/HTTP 500/);
  });

  it('exits 2 with a network-error diagnostic when fetch rejects', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/Network error/);
  });

  it('exits 2 with a write-failure diagnostic when the local path is not writable', async () => {
    // Make tempDir read-only so writing the local file fails.
    chmodSync(tempDir, 0o500);
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(SAMPLE_DATA) }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/Failed to write/);
    expect(result.message).toContain(localPath);
  });

  it('exits 3 when upstream returns invalid JSON', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: 'not json' }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(3);
    expect(result.message).toMatch(/not valid JSON/);
  });

  it('preserves the local `$schema` IDE hint when upstream does not carry one', async () => {
    // Upstream is canonical (no `$schema`); local carries the IDE-hint `$schema` so editors validate
    // edits against the colocated schema. Sync must re-inject `$schema` so the file remains
    // self-validating after the upstream content overwrites the local copy. This is symmetric with
    // `checkWorkTypesDrift`, which strips local `$schema` before comparing.
    const localContent = `${JSON.stringify({ $schema: './work-types.schema.json', ...SAMPLE_DATA }, null, 2)}\n`;
    writeFileSync(localPath, localContent, 'utf8');
    const upstreamData = {
      ...SAMPLE_DATA,
      types: [
        ...SAMPLE_DATA.types,
        { tier: 'Public', key: 'sec', aliases: [], emoji: '🔒', label: 'Security', breakingPolicy: 'optional' },
      ],
    };
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(upstreamData) }));

    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });

    expect(result.exitCode).toBe(0);
    const synced = readFileSync(localPath, 'utf8');
    expect(synced).toContain('"$schema": "./work-types.schema.json"');
    // Inject must serialise at the top so editors find it on the first scan.
    expect(synced.indexOf('"$schema"')).toBeLessThan(synced.indexOf('"tiers"'));
  });

  it('does not inject `$schema` when local file does not carry one', async () => {
    // If the prior local content lacks `$schema` (e.g., upstream-canonical write), the sync must not
    // hallucinate one — the absence is itself the local truth.
    writeFileSync(localPath, `${JSON.stringify(SAMPLE_DATA, null, 2)}\n`, 'utf8');
    const upstreamData = { ...SAMPLE_DATA, tiers: ['Public', 'Internal', 'Process', 'Future'] };
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(upstreamData) }));

    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });

    expect(result.exitCode).toBe(0);
    const synced = readFileSync(localPath, 'utf8');
    expect(synced).not.toContain('$schema');
  });

  it('exits 3 when upstream JSON is missing required top-level keys', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify({ unrelated: true }) }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(3);
    expect(result.message).toMatch(/expected schema shape/);
  });
});
