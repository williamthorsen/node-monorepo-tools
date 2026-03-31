import { afterEach, describe, expect, it, vi } from 'vitest';

const mockMkdtempSync = vi.hoisted(() => vi.fn());
const mockRmSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  mkdtempSync: mockMkdtempSync,
  rmSync: mockRmSync,
  writeFileSync: mockWriteFileSync,
}));

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import { loadRemoteConfig } from '../src/loadRemoteConfig.ts';

/** Build a minimal mock Response with the given body and status. */
function mockResponse(
  body: string,
  init?: { status?: number; statusText?: string },
): Pick<Response, 'ok' | 'status' | 'statusText' | 'text' | 'headers'> {
  return {
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    text: () => Promise.resolve(body),
    headers: new Headers(),
  };
}

describe(loadRemoteConfig, () => {
  afterEach(() => {
    mockMkdtempSync.mockReset();
    mockRmSync.mockReset();
    mockWriteFileSync.mockReset();
    mockFetch.mockReset();
  });

  it('throws on non-2xx responses', async () => {
    mockFetch.mockResolvedValue(mockResponse('Not Found', { status: 404, statusText: 'Not Found' }));

    await expect(loadRemoteConfig({ url: 'https://example.com/config.js' })).rejects.toThrow(
      'Failed to fetch remote config from https://example.com/config.js: 404 Not Found',
    );
  });

  it('detects HTML error pages', async () => {
    mockFetch.mockResolvedValue(mockResponse('<!DOCTYPE html><html><body>Error</body></html>'));

    await expect(loadRemoteConfig({ url: 'https://example.com/config.js' })).rejects.toThrow(
      'Remote config URL returned an HTML page instead of JavaScript',
    );
  });

  it('detects HTML pages with <html prefix', async () => {
    mockFetch.mockResolvedValue(mockResponse('<html><body>Error</body></html>'));

    await expect(loadRemoteConfig({ url: 'https://example.com/config.js' })).rejects.toThrow(
      'Remote config URL returned an HTML page instead of JavaScript',
    );
  });

  it('sends authorization header when token is provided', async () => {
    mockFetch.mockResolvedValue(mockResponse('Not Found', { status: 404, statusText: 'Not Found' }));

    await loadRemoteConfig({ url: 'https://example.com/config.js', token: 'my-token' }).catch(() => {
      // Expected to throw due to 404
    });

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/config.js', {
      headers: { Authorization: 'token my-token' },
    });
  });

  it('does not send authorization header when no token is provided', async () => {
    mockFetch.mockResolvedValue(mockResponse('Not Found', { status: 404, statusText: 'Not Found' }));

    await loadRemoteConfig({ url: 'https://example.com/config.js' }).catch(() => {
      // Expected to throw due to 404
    });

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/config.js', {
      headers: {},
    });
  });

  it('cleans up temp directory even on failure', async () => {
    mockFetch.mockResolvedValue(mockResponse('export default {};'));
    mockMkdtempSync.mockReturnValue('/tmp/preflight-abc');

    await loadRemoteConfig({ url: 'https://example.com/config.js' }).catch(() => {
      // Expected to throw due to invalid config
    });

    expect(mockRmSync).toHaveBeenCalledWith('/tmp/preflight-abc', { recursive: true, force: true });
  });
});
