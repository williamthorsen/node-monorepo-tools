import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertIsPreflightCollection } from './assertIsPreflightCollection.ts';
import { isRecord } from './isRecord.ts';
import { resolveCollectionExports } from './resolveCollectionExports.ts';
import type { PreflightCollection } from './types.ts';
import { validateCollection } from './validateCollection.ts';

export interface LoadRemoteCollectionOptions {
  url: string;
  token?: string;
}

/**
 * Fetch a remote `.js` collection bundle, evaluate it, and return a validated PreflightCollection.
 *
 * Writes the fetched content to a temp file for dynamic import, then cleans up.
 */
export async function loadRemoteCollection({ url, token }: LoadRemoteCollectionOptions): Promise<PreflightCollection> {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.Authorization = `token ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch remote collection from ${url}: ${response.status} ${response.statusText}`);
  }

  const body = await response.text();

  // Detect HTML error pages (e.g., GitHub 404 pages that return 200)
  const trimmedBody = body.trimStart().toLowerCase();
  if (trimmedBody.startsWith('<html') || trimmedBody.startsWith('<!doctype')) {
    throw new Error(`Remote collection URL returned an HTML page instead of JavaScript: ${url}`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'preflight-'));
  const tempFile = join(tempDir, 'collection.js');

  try {
    writeFileSync(tempFile, body, 'utf8');

    const fileUrl = `${pathToFileURL(tempFile).href}?t=${Date.now()}`;
    const imported: unknown = await import(fileUrl);
    // Narrow the module namespace to access exports. `import()` always returns an object,
    // but TypeScript types it as `any`; narrowing avoids unsafe-member-access lint errors.
    const moduleRecord = isRecord(imported) ? imported : {};
    const resolved = resolveCollectionExports(moduleRecord);
    assertIsPreflightCollection(resolved);
    validateCollection(resolved);
    return resolved;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
