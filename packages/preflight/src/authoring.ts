import type { PreflightChecklist, PreflightCollection, PreflightConfig, PreflightStagedChecklist } from './types.ts';

/** Type-safe identity function for defining repo-level preflight settings. */
export function definePreflightConfig(config: PreflightConfig): PreflightConfig {
  return config;
}

/** Type-safe identity function for defining a preflight collection in a config file. */
export function definePreflightCollection(collection: PreflightCollection): PreflightCollection {
  return collection;
}

/** Type-safe identity function for defining an array of checklists in a config file. */
export function defineChecklists(
  checklists: Array<PreflightChecklist | PreflightStagedChecklist>,
): Array<PreflightChecklist | PreflightStagedChecklist> {
  return checklists;
}

/** Type-safe identity function for defining a flat checklist. */
export function definePreflightChecklist(checklist: PreflightChecklist): PreflightChecklist {
  return checklist;
}

/** Type-safe identity function for defining a staged checklist. */
export function definePreflightStagedChecklist(checklist: PreflightStagedChecklist): PreflightStagedChecklist {
  return checklist;
}
