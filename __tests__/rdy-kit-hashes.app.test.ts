import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { syncLabelsWorkflow } from '../packages/release-kit/src/sync-labels/templates.ts';
import { SYNC_LABELS_WORKFLOW_HASH } from '../.rdy/kits/release-kit.ts';

/** Compute SHA-256 hex digest, matching readyup's computeHash implementation. */
function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Verify that embedded hashes in the rdy kit stay in sync with the template
 * functions. If a hash check fails, update the constant in .rdy/kits/release-kit.ts
 * to match the new hash shown in the error message.
 */
describe('rdy kit hashes match template output', () => {
  it('SYNC_LABELS_WORKFLOW_HASH matches syncLabelsWorkflow()', () => {
    const actualHash = sha256(syncLabelsWorkflow());

    expect(
      actualHash,
      `SYNC_LABELS_WORKFLOW_HASH in .rdy/kits/release-kit.ts is stale — update it to: ${actualHash}`,
    ).toBe(SYNC_LABELS_WORKFLOW_HASH);
  });
});
