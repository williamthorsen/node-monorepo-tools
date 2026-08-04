import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeHash } from 'readyup/check-utils';
import { describe, expect, it } from 'vitest';

import {
  CLIFF_TEMPLATE_HASH,
  COMMON_PRESET_HASH,
  PUBLISH_WORKFLOW_HASH_MONOREPO,
  PUBLISH_WORKFLOW_HASH_SINGLE,
  RELEASE_WORKFLOW_HASH_MONOREPO,
  RELEASE_WORKFLOW_HASH_SINGLE,
  SYNC_LABELS_WORKFLOW_HASH,
} from '../../.readyup/kits/default.ts';
import { publishWorkflow, releaseWorkflow } from '../init/templates.ts';
import { syncLabelsWorkflow } from '../sync-labels/templates.ts';

const packageDir = join(import.meta.dirname, '..', '..');
const presetsDir = join(packageDir, 'presets', 'labels');

/**
 * Verifies that the hashes embedded in the kit stay in sync with the artifacts they describe. Every anchor is
 * inside this package, so a template edited here fails the check without reaching outside the package boundary.
 * On failure, update the constant in `.readyup/kits/default.ts` to the hash the error message names.
 */
describe('rdy kit hashes match their source artifacts', () => {
  it('CLIFF_TEMPLATE_HASH matches cliff.toml.template', () => {
    const actualHash = computeHash(readFileSync(join(packageDir, 'cliff.toml.template'), 'utf8'));

    expect(actualHash, `CLIFF_TEMPLATE_HASH is stale -- update it to: ${actualHash}`).toBe(CLIFF_TEMPLATE_HASH);
  });

  it('COMMON_PRESET_HASH matches presets/labels/common.yaml', () => {
    const actualHash = computeHash(readFileSync(join(presetsDir, 'common.yaml'), 'utf8'));

    expect(actualHash, `COMMON_PRESET_HASH is stale -- update it to: ${actualHash}`).toBe(COMMON_PRESET_HASH);
  });

  it('PUBLISH_WORKFLOW_HASH_MONOREPO matches publishWorkflow("monorepo")', () => {
    const actualHash = computeHash(publishWorkflow('monorepo'));

    expect(actualHash, `PUBLISH_WORKFLOW_HASH_MONOREPO is stale -- update it to: ${actualHash}`).toBe(
      PUBLISH_WORKFLOW_HASH_MONOREPO,
    );
  });

  it('PUBLISH_WORKFLOW_HASH_SINGLE matches publishWorkflow("single-package")', () => {
    const actualHash = computeHash(publishWorkflow('single-package'));

    expect(actualHash, `PUBLISH_WORKFLOW_HASH_SINGLE is stale -- update it to: ${actualHash}`).toBe(
      PUBLISH_WORKFLOW_HASH_SINGLE,
    );
  });

  it('RELEASE_WORKFLOW_HASH_MONOREPO matches releaseWorkflow("monorepo")', () => {
    const actualHash = computeHash(releaseWorkflow('monorepo'));

    expect(actualHash, `RELEASE_WORKFLOW_HASH_MONOREPO is stale -- update it to: ${actualHash}`).toBe(
      RELEASE_WORKFLOW_HASH_MONOREPO,
    );
  });

  it('RELEASE_WORKFLOW_HASH_SINGLE matches releaseWorkflow("single-package")', () => {
    const actualHash = computeHash(releaseWorkflow('single-package'));

    expect(actualHash, `RELEASE_WORKFLOW_HASH_SINGLE is stale -- update it to: ${actualHash}`).toBe(
      RELEASE_WORKFLOW_HASH_SINGLE,
    );
  });

  it('SYNC_LABELS_WORKFLOW_HASH matches syncLabelsWorkflow()', () => {
    const actualHash = computeHash(syncLabelsWorkflow());

    expect(actualHash, `SYNC_LABELS_WORKFLOW_HASH is stale -- update it to: ${actualHash}`).toBe(
      SYNC_LABELS_WORKFLOW_HASH,
    );
  });
});
