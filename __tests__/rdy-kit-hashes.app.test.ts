import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUDIT_WORKFLOW_HASH } from '../.readyup/kits/audit-deps.ts';
import {
  CLIFF_TEMPLATE_HASH,
  COMMON_PRESET_HASH,
  PUBLISH_WORKFLOW_HASH_MONOREPO,
  PUBLISH_WORKFLOW_HASH_SINGLE,
  RELEASE_WORKFLOW_HASH_MONOREPO,
  RELEASE_WORKFLOW_HASH_SINGLE,
  SYNC_LABELS_WORKFLOW_HASH,
} from '../.readyup/kits/release-kit.ts';
import { publishWorkflow, releaseWorkflow } from '../packages/release-kit/src/init/templates.ts';
import { syncLabelsWorkflow } from '../packages/release-kit/src/sync-labels/templates.ts';

/** Compute SHA-256 hex digest, matching readyup's computeHash implementation. */
function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const releaseKitDir = join(import.meta.dirname, '..', 'packages', 'release-kit');
const presetsDir = join(releaseKitDir, 'presets', 'labels');

/**
 * Verify that embedded hashes in the rdy kit stay in sync with the source
 * files. If a hash check fails, update the constant in the relevant
 * `.readyup/kits/*.ts` file to match the new hash shown in the error message.
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

  it('AUDIT_WORKFLOW_HASH matches .github/workflows/audit.yaml', () => {
    const content = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'audit.yaml'), 'utf8');
    const actualHash = sha256(content);

    expect(
      actualHash,
      `AUDIT_WORKFLOW_HASH in .readyup/kits/audit-deps.ts is stale — update it to: ${actualHash}`,
    ).toBe(AUDIT_WORKFLOW_HASH);
  });

  it('RELEASE_WORKFLOW_HASH_MONOREPO matches releaseWorkflow("monorepo")', () => {
    const actualHash = sha256(releaseWorkflow('monorepo'));

    expect(
      actualHash,
      `RELEASE_WORKFLOW_HASH_MONOREPO in .readyup/kits/release-kit.ts is stale — update it to: ${actualHash}`,
    ).toBe(RELEASE_WORKFLOW_HASH_MONOREPO);
  });

  it('RELEASE_WORKFLOW_HASH_SINGLE matches releaseWorkflow("single-package")', () => {
    const actualHash = sha256(releaseWorkflow('single-package'));

    expect(
      actualHash,
      `RELEASE_WORKFLOW_HASH_SINGLE in .readyup/kits/release-kit.ts is stale — update it to: ${actualHash}`,
    ).toBe(RELEASE_WORKFLOW_HASH_SINGLE);
  });

  it('PUBLISH_WORKFLOW_HASH_MONOREPO matches publishWorkflow("monorepo")', () => {
    const actualHash = sha256(publishWorkflow('monorepo'));

    expect(
      actualHash,
      `PUBLISH_WORKFLOW_HASH_MONOREPO in .readyup/kits/release-kit.ts is stale — update it to: ${actualHash}`,
    ).toBe(PUBLISH_WORKFLOW_HASH_MONOREPO);
  });

  it('PUBLISH_WORKFLOW_HASH_SINGLE matches publishWorkflow("single-package")', () => {
    const actualHash = sha256(publishWorkflow('single-package'));

    expect(
      actualHash,
      `PUBLISH_WORKFLOW_HASH_SINGLE in .readyup/kits/release-kit.ts is stale — update it to: ${actualHash}`,
    ).toBe(PUBLISH_WORKFLOW_HASH_SINGLE);
  });
});
