import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CLIFF_TEMPLATE_HASH, COMMON_PRESET_HASH, SYNC_LABELS_WORKFLOW_HASH } from '../.readyup/kits/release-kit.ts';
import { syncLabelsWorkflow } from '../packages/release-kit/src/sync-labels/templates.ts';

/** Compute SHA-256 hex digest, matching readyup's computeHash implementation. */
function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const releaseKitDir = join(import.meta.dirname, '..', 'packages', 'release-kit');
const presetsDir = join(releaseKitDir, 'presets', 'labels');

/**
 * Verify that embedded hashes in the rdy kit stay in sync with the source
 * files. If a hash check fails, update the constant in .readyup/kits/release-kit.ts
 * to match the new hash shown in the error message.
 */
describe('rdy kit hashes match source files', () => {
  it('CLIFF_TEMPLATE_HASH matches cliff.toml.template', () => {
    const content = readFileSync(join(releaseKitDir, 'cliff.toml.template'), 'utf8');
    const actualHash = sha256(content);

    expect(
      actualHash,
      `CLIFF_TEMPLATE_HASH in .readyup/kits/release-kit.ts is stale — update it to: ${actualHash}`,
    ).toBe(CLIFF_TEMPLATE_HASH);
  });

  it('SYNC_LABELS_WORKFLOW_HASH matches syncLabelsWorkflow()', () => {
    const actualHash = sha256(syncLabelsWorkflow());

    expect(
      actualHash,
      `SYNC_LABELS_WORKFLOW_HASH in .readyup/kits/release-kit.ts is stale — update it to: ${actualHash}`,
    ).toBe(SYNC_LABELS_WORKFLOW_HASH);
  });

  it('COMMON_PRESET_HASH matches presets/labels/common.yaml', () => {
    const content = readFileSync(join(presetsDir, 'common.yaml'), 'utf8');
    const actualHash = sha256(content);

    expect(
      actualHash,
      `COMMON_PRESET_HASH in .readyup/kits/release-kit.ts is stale — update it to: ${actualHash}`,
    ).toBe(COMMON_PRESET_HASH);
  });
});
