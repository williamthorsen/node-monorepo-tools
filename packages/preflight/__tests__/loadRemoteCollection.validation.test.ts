import { afterEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import { loadRemoteCollection } from '../src/loadRemoteCollection.ts';

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

describe('loadRemoteCollection validation', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('resolves a module with a valid checklists export', async () => {
    const jsBody = `
      export const checklists = [
        { name: 'test', checks: [{ name: 'check-a', check: () => true }] },
      ];
    `;
    mockFetch.mockResolvedValue(mockResponse(jsBody));

    const collection = await loadRemoteCollection({ url: 'https://example.com/config.js' });

    expect(collection.checklists).toHaveLength(1);
    expect(collection.checklists[0].name).toBe('test');
  });

  it('throws when the module lacks a checklists export', async () => {
    const jsBody = 'export default {};';
    mockFetch.mockResolvedValue(mockResponse(jsBody));

    await expect(loadRemoteCollection({ url: 'https://example.com/config.js' })).rejects.toThrow(
      'Collection file must export checklists',
    );
  });

  it('carries through fixLocation when exported', async () => {
    const jsBody = `
      export const fixLocation = 'inline';
      export const checklists = [
        { name: 'test', checks: [{ name: 'check-a', check: () => true }] },
      ];
    `;
    mockFetch.mockResolvedValue(mockResponse(jsBody));

    const collection = await loadRemoteCollection({ url: 'https://example.com/config.js' });

    expect(collection.fixLocation).toBe('inline');
  });

  it('omits fixLocation when not exported', async () => {
    const jsBody = `
      export const checklists = [
        { name: 'test', checks: [{ name: 'check-a', check: () => true }] },
      ];
    `;
    mockFetch.mockResolvedValue(mockResponse(jsBody));

    const collection = await loadRemoteCollection({ url: 'https://example.com/config.js' });

    expect(collection.fixLocation).toBeUndefined();
  });
});
