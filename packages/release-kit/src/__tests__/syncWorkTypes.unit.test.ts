import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
