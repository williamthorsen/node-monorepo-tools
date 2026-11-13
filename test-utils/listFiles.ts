import { readdirSync } from 'node:fs';
import path from 'node:path';

/** Walks `relativeDir` under `rootDir`, returning every file outside the pruned directories as a root-relative POSIX path. */
export function listFiles(rootDir: string, prunedNames: ReadonlySet<string>, relativeDir = ''): string[] {
  return readdirSync(path.join(rootDir, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return prunedNames.has(entry.name) ? [] : listFiles(rootDir, prunedNames, relativePath);
    }
    return entry.isFile() ? relativePath : [];
  });
}
