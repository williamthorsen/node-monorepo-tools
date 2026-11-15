import { createServer } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { realNpm } from '../npm-registry.ts';

describe('realNpm', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses npm's error envelope when the registry cannot be reached", async () => {
    // Without retries, npm reports the refused connection at once rather than after its backoff.
    vi.stubEnv('npm_config_fetch_retries', '0');
    const registry = `http://127.0.0.1:${await reserveClosedPort()}/`;

    const result = realNpm.viewVersion('left-pad', registry);

    expect(result).toMatchObject({ ok: false, error: { code: 'ECONNREFUSED' } });
  });
});

// region | Helpers

/** Returns a loopback port that nothing listens on, by listening on an ephemeral port and closing it. */
async function reserveClosedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP address');
  }
  return address.port;
}

// endregion | Helpers
