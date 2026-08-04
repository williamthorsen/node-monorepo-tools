import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeHash } from 'readyup/check-utils';
import { describe, expect, it } from 'vitest';

import { AUDIT_WORKFLOW_HASH } from '../../.readyup/kits/default.ts';

const packageDir = join(import.meta.dirname, '..', '..');

/**
 * Verifies that the hash embedded in the kit stays in sync with the template it describes. The anchor is the
 * template this package ships and `v11y-check init` scaffolds, so a template edited here fails the check.
 * On failure, update the constant in `.readyup/kits/default.ts` to the hash the error message names.
 */
describe('rdy kit hashes match their source artifacts', () => {
  it('AUDIT_WORKFLOW_HASH matches templates/audit.yaml.template', () => {
    const actualHash = computeHash(readFileSync(join(packageDir, 'templates', 'audit.yaml.template'), 'utf8'));

    expect(actualHash, `AUDIT_WORKFLOW_HASH is stale -- update it to: ${actualHash}`).toBe(AUDIT_WORKFLOW_HASH);
  });
});
