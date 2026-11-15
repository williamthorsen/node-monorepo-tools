import { afterEach, describe, expect, it, vi } from 'vitest';

import { realGh } from '../gh.ts';

describe('realGh', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports that gh is unavailable when it is not on the PATH', () => {
    vi.stubEnv('PATH', '');

    expect(realGh.isAvailable()).toBe(false);
  });
});
