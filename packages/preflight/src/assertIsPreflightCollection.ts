import { z } from 'zod';

import type { PreflightCollection } from './types.ts';

/** Schema for a flat checklist (has `checks`, no `groups`). */
const FlatChecklistSchema = z.looseObject({
  name: z.string().min(1),
  checks: z.array(z.unknown()),
});

/** Schema for a staged checklist (has `groups`, no `checks`). */
const StagedChecklistSchema = z.looseObject({
  name: z.string().min(1),
  groups: z.array(z.unknown()),
});

const ChecklistSchema = z
  .union([FlatChecklistSchema, StagedChecklistSchema])
  .refine((val) => !('checks' in val && 'groups' in val), {
    message: "Checklist cannot have both 'checks' and 'groups'",
  });

/** Structural schema for a PreflightCollection. */
const PreflightCollectionSchema = z.looseObject({
  fixLocation: z.enum(['INLINE', 'END']).optional(),
  checklists: z.array(ChecklistSchema),
  suites: z.record(z.string(), z.array(z.string())).optional(),
});

/**
 * Validate that a raw value conforms to the PreflightCollection shape.
 *
 * Throws a ZodError on invalid input. When it returns without throwing, the value is a valid
 * PreflightCollection. Function-valued properties like `check` are passed through without
 * validation because jiti loads the actual TypeScript module and preserves original types.
 */
export function assertIsPreflightCollection(raw: unknown): asserts raw is PreflightCollection {
  PreflightCollectionSchema.parse(raw);
}
