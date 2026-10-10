import { isRecord } from './typeGuards.ts';

/** Reports whether a parsed `package.json` can be published: its `private` field is absent or `false`. */
export function isPublishableManifest(manifest: unknown): boolean {
  const privateField = isRecord(manifest) ? manifest['private'] : undefined;
  // Treat any `private` value other than `false` as private; npm and pnpm refuse to publish on a truthy non-boolean.
  return privateField === undefined || privateField === false;
}
