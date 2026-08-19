import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { syncWorkTypes } from '../syncWorkTypes.ts';

const FIXTURE_URL = 'https://test.example/work-types.json';

const SAMPLE_DATA = {
  tiers: ['public', 'internal', 'process'],
  types: [
    {
      tier: 'public',
      key: 'feat',
      aliases: ['feature'],
      emoji: '🎉',
      label: 'Features',
      breakingPolicy: 'optional',
    },
  ],
};

const it = baseIt
  .extend(
    'tree',
    makeFixture(() => makeRestorableTree()),
  )
  .extend('localPath', ({ tree }) => join(tree.dir, 'work-types.json'));

describe(syncWorkTypes, () => {
  beforeEach(() => {
    // Default to no token so tests are deterministic regardless of the host shell's environment.
    // Individual tests opt into a stubbed token by calling `vi.stubEnv('GITHUB_TOKEN', '<value>')`.
    vi.stubEnv('GITHUB_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exits 0 when sync writes new content to local', async ({ localPath }) => {
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(SAMPLE_DATA) }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/Synced/);
  });

  it('exits 0 when local already matches upstream', async ({ localPath }) => {
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

  it('exits 2 on a non-OK non-success HTTP status', async ({ localPath }) => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 500, statusText: 'Internal Server Error', body: '' }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/Error: Failed to fetch upstream work-types\.json: HTTP 500/);
  });

  it('exits 2 with a network-error diagnostic when fetch rejects', async ({ localPath }) => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/Error: Failed to fetch upstream work-types\.json: ECONNREFUSED/);
  });

  it('exits 2 with a write-failure diagnostic when the local path is not writable', async ({ localPath, tree }) => {
    // Make the directory read-only so writing the local file fails.
    chmodSync(tree.dir, 0o500);
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(SAMPLE_DATA) }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/Error: Failed to write/);
    expect(result.message).toContain(localPath);
  });

  it('exits 3 when upstream returns invalid JSON', async ({ localPath }) => {
    const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: 'not json' }));
    const result = await syncWorkTypes({
      localPath,
      upstreamUrl: FIXTURE_URL,
      fetch: fakeFetch,
    });
    expect(result.exitCode).toBe(3);
    expect(result.message).toMatch(/not valid JSON/);
  });

  it('preserves the local `$schema` IDE hint when upstream does not carry one', async ({ localPath }) => {
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
        { tier: 'public', key: 'sec', aliases: [], emoji: '🔒', label: 'Security', breakingPolicy: 'optional' },
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

  it('does not inject `$schema` when local file does not carry one', async ({ localPath }) => {
    // If the prior local content lacks `$schema` (e.g., upstream-canonical write), the sync must not
    // hallucinate one — the absence is itself the local truth.
    writeFileSync(localPath, `${JSON.stringify(SAMPLE_DATA, null, 2)}\n`, 'utf8');
    const upstreamData = { ...SAMPLE_DATA, tiers: ['public', 'internal', 'process', 'future'] };
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

  it('exits 3 when upstream JSON is missing required top-level keys', async ({ localPath }) => {
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

  describe('GITHUB_TOKEN auth header', () => {
    it('sends `Authorization: Bearer <token>` when GITHUB_TOKEN is set', async ({ localPath }) => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_test_token_value');
      const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(SAMPLE_DATA) }));
      await syncWorkTypes({ localPath, upstreamUrl: FIXTURE_URL, fetch: fakeFetch });
      expect(fakeFetch).toHaveBeenCalledWith(FIXTURE_URL, {
        headers: { Authorization: 'Bearer ghp_test_token_value' },
      });
    });

    it('sends no `init` argument when GITHUB_TOKEN is unset', async ({ localPath }) => {
      vi.stubEnv('GITHUB_TOKEN', '');
      const fakeFetch = vi.fn().mockResolvedValue(makeResponse({ status: 200, body: JSON.stringify(SAMPLE_DATA) }));
      await syncWorkTypes({ localPath, upstreamUrl: FIXTURE_URL, fetch: fakeFetch });
      expect(fakeFetch).toHaveBeenCalledWith(FIXTURE_URL);
      expect(fakeFetch.mock.calls[0]).toHaveLength(1);
    });
  });
});

// region | Helpers

/** Build a `Response`-like object the helper can consume. */
function makeResponse(init: { status: number; statusText?: string; body: string }): Response {
  const responseInit: ResponseInit = {
    status: init.status,
    statusText: init.statusText ?? 'OK',
  };
  return new Response(init.body, responseInit);
}

/**
 * Creates a temporary tree that restores its own write permission before disposal. Disposal is a bare recursive
 * remove, and a directory a test left read-only cannot have its entries unlinked until the mode is restored.
 */
function makeRestorableTree(): Disposable & { dir: string } {
  const tree = createTempTree({}, { prefix: 'work-types-sync-' });

  return {
    dir: tree.dir,
    [Symbol.dispose]() {
      try {
        chmodSync(tree.dir, 0o755);
      } catch {
        // The directory may already be writable.
      }
      tree[Symbol.dispose]();
    },
  };
}

// endregion | Helpers
