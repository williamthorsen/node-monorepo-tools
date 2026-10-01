/** Checks whether a publish workflow enables provenance on an uncommented line. */
export function hasProvenance(workflowContent: string): boolean {
  return /^[^#]*provenance:\s*['"]?true['"]?/im.test(workflowContent);
}
