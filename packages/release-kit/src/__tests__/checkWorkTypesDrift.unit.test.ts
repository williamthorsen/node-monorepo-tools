import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkWorkTypesDrift } from '../checkWorkTypesDrift.ts';

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

describe(checkWorkTypesDrift, () => {
  let tempDir: string;
  let localPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'work-types-drift-'));
    localPath = join(tempDir, 'work-types.json');
    writeFileSync(localPath, `${JSON.stringify(SAMPLE_DATA, null, 2)}\n`, 'utf8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exits 0 with a match message when local equals upstream', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(SAMPLE_DATA) }));
    const result = await checkWorkTypesDrift({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/matches upstream/);
    expect(fakeFetch).toHaveBeenCalledWith(FIXTURE_URL);
  });

  it('exits 1 with a drift message when local differs from upstream', async () => {
    const upstreamData = {
      ...SAMPLE_DATA,
      types: [
        {
          ...SAMPLE_DATA.types[0],
          label: 'Renamed features',
        },
      ],
    };
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(upstreamData) }));
    const result = await checkWorkTypesDrift({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/Drift detected/);
  });

  it('exits 0 with a transitional warning when upstream returns 404', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 404, body: 'Not Found' }));
    const result = await checkWorkTypesDrift({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/not yet published/);
  });

  it('exits 2 on a non-OK non-404 HTTP status', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 500, statusText: 'Internal', body: '' }));
    const result = await checkWorkTypesDrift({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/HTTP 500/);
  });

  it('exits 2 on a network error (rejected fetch)', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkWorkTypesDrift({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/Network error/);
  });

  it('exits 3 on a schema mismatch (upstream JSON missing tiers/types)', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify({ unrelated: true }) }));
    const result = await checkWorkTypesDrift({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(3);
    expect(result.message).toMatch(/expected schema shape/);
  });

  it('exits 3 when upstream returns invalid JSON', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: 'not json' }));
    const result = await checkWorkTypesDrift({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(3);
    expect(result.message).toMatch(/not valid JSON/);
  });
});
