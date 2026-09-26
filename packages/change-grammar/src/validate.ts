import type { ChangeRecord, Taxonomy } from './types.ts';

/**
 * Reports the breaking-policy violation in a record, or nothing when the record has none. The record is returned
 * untouched: Normalizing a violation away would hide the mistake from the author who can still fix it.
 *
 * A record violates by setting the marker when its type's policy forbids it. A record naming a type not declared by
 * the taxonomy has no policy to break.
 */
export function validate(record: ChangeRecord, taxonomy: Taxonomy): PolicyViolation | undefined {
  const workType = taxonomy.types.find((candidate) => candidate.key === record.type);
  if (workType === undefined) {
    return undefined;
  }
  const policy = workType.breakingPolicy ?? 'optional';
  const breaking = record.breaking === true;

  if (policy === 'forbidden' && breaking) {
    return { policy, type: workType.key };
  }
  return undefined;
}

/** A record whose breaking marker disagrees with its type's policy. */
export interface PolicyViolation {
  policy: 'forbidden';
  type: string;
}
