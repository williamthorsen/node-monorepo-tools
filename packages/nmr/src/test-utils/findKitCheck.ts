import { isFlatChecklist, type RdyCheck } from 'readyup';
import { assert } from 'vitest';

import kit from '../../.readyup/kits/default.ts';

/** Finds a check by name in the kit's `nmr` checklist, asserting it exists so a rename fails loudly. */
export function findKitCheck(name: string): RdyCheck {
  const checklist = kit.checklists.find((candidate) => candidate.name === 'nmr');
  assert(checklist && isFlatChecklist(checklist), 'Expected the kit to carry a flat `nmr` checklist');

  const check = checklist.checks.find((candidate) => candidate.name === name);
  assert(check, `Expected the nmr checklist to carry a "${name}" check`);
  return check;
}
