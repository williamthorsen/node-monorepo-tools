import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertIsPreflightConfig, isRecord } from './assertIsPreflightConfig.ts';
import type { PreflightConfig } from './types.ts';

export interface LoadRemoteConfigOptions {
  url: string;
  token?: string;
}

/**
 * Fetch a remote `.js` config bundle, evaluate it, and return a validated PreflightConfig.
 *
 * Writes the fetched content to a temp file for dynamic import, then cleans up.
 */
export async function loadRemoteConfig({ url, token }: LoadRemoteConfigOptions): Promise<PreflightConfig> {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.Authorization = `token ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch remote config from ${url}: ${response.status} ${response.statusText}`);
  }

  const body = await response.text();

  // Detect HTML error pages (e.g., GitHub 404 pages that return 200)
  const trimmedBody = body.trimStart().toLowerCase();
  if (trimmedBody.startsWith('<html') || trimmedBody.startsWith('<!doctype')) {
    throw new Error(`Remote config URL returned an HTML page instead of JavaScript: ${url}`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'preflight-'));
  const tempFile = join(tempDir, 'config.js');

  try {
    writeFileSync(tempFile, body, 'utf8');

    const fileUrl = pathToFileURL(tempFile).href + `?t=${Date.now()}`;
    const imported: unknown = await import(fileUrl);

    if (!isRecord(imported)) {
      throw new Error(
        `Remote config must export an object, got ${Array.isArray(imported) ? 'array' : typeof imported}`,
      );
    }

    const resolved = imported.default ?? imported.config;
    if (resolved === undefined) {
      throw new Error('Remote config must have a default export or a named `config` export');
    }

    assertIsPreflightConfig(resolved);
    return resolved;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
