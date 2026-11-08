export type { Overrides } from './record/apply-overrides.ts';
export { applyOverrides } from './record/apply-overrides.ts';
export { consolidate } from './record/consolidate.ts';
export type { TokenName } from './record/tokens.ts';
export {
  BREAKING_MARKER,
  dropIncidentalRoot,
  normalizeChangeRecord,
  ROOT_SCOPE,
  splitScopes,
} from './record/tokens.ts';
export type {
  BreakingPolicy,
  CanonicalTaxonomy,
  CanonicalWorkTypeEntry,
  ChangeRecord,
  Taxonomy,
  WorkTypeEntry,
} from './record/types.ts';
export type { PolicyViolation } from './record/validate.ts';
export { validate } from './record/validate.ts';
export type { LabelMap } from './taxonomy/derive-label-map.ts';
export { deriveLabelMap } from './taxonomy/derive-label-map.ts';
export { CANONICAL_TAXONOMY } from './taxonomy/taxonomy.ts';
export type { TemplateNode, TokenNode } from './template/compile-template.ts';
export { compileTemplate } from './template/compile-template.ts';
export { canonicalizeType, parse, TICKET_PREFIX_PATTERNS } from './template/parse.ts';
export { render } from './template/render.ts';
export type { ConventionName } from './template/templates.ts';
export { TEMPLATE_CATALOGUE } from './template/templates.ts';
export { findLossyRenders, verify } from './template/verify.ts';
