import type { SyncResult } from '../sync.ts';

/** Formats one scope's sync result as text, listing each added advisory with its current chains and each removed one. */
export function formatSyncResult(syncResult: SyncResult): string {
  const lines = [`\n--- ${syncResult.scope} ---`, `  added: ${syncResult.added.length}`];
  for (const entry of syncResult.added) {
    lines.push(`    ${entry.id}`, ...entry.paths.map((chain) => `      ${chain}`));
  }
  lines.push(`  kept: ${syncResult.kept.length}`, `  removed: ${syncResult.removed.length}`);
  for (const entry of syncResult.removed) {
    lines.push(`    ${entry.id}`);
  }
  return lines.join('\n') + '\n';
}
