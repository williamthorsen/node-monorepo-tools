import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeHash } from 'readyup/check-utils';
import { describe, expect, it } from 'vitest';

import { COMMON_PRESET_HASH, SYNC_LABELS_WORKFLOW_HASH } from '../../.readyup/lib/workflow-hashes.ts';
import { hashPreset } from '../sync-labels/presets.ts';

/**
 * Verifies that the hashes embedded in the kit stay in sync with the artifacts that they describe: the sync-labels
 * workflow template and the common label preset. A work-type edit in change-grammar's taxonomy fails this check too,
 * because the common preset depends on that taxonomy. On failure, update the constant in
 * `.readyup/lib/workflow-hashes.ts` to the hash that the error message names, then run `rdy compile` in this package.
 */
describe('rdy kit hashes match their source artifacts', () => {
  it('COMMON_PRESET_HASH matches the resolved common preset', () => {
    const actualHash = hashPreset('common');

    expect(actualHash, `COMMON_PRESET_HASH is stale -- update it to: ${actualHash}`).toBe(COMMON_PRESET_HASH);
  });

  it('SYNC_LABELS_WORKFLOW_HASH matches templates/sync-labels.yaml.template', () => {
    const template = readFileSync(
      join(import.meta.dirname, '..', '..', 'templates', 'sync-labels.yaml.template'),
      'utf8',
    );
    const actualHash = computeHash(template);

    expect(actualHash, `SYNC_LABELS_WORKFLOW_HASH is stale -- update it to: ${actualHash}`).toBe(
      SYNC_LABELS_WORKFLOW_HASH,
    );
  });
});
