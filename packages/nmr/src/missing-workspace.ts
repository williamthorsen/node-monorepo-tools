/** The manifest whose absence the lines below report. */
const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

/** Returns the line refusing a script that composes a `-R` step, at a root that does not declare a workspace. */
export function formatComposedRecursionWithoutWorkspace(command: string, root: string): string {
  return `\`${command}\` fans out to workspace packages, which needs a pnpm workspace: ${describeAbsence(root)}`;
}

/** Returns the line refusing `-F`, at a root that does not declare a workspace. */
export function formatFilterWithoutWorkspace(pattern: string, root: string): string {
  return (
    `-F/--filter needs a pnpm workspace: \`${pattern}\` was not matched, because no ${WORKSPACE_MANIFEST} is in ` +
    `${root} or any parent directory.`
  );
}

/** Returns the line refusing `-R`, at a root that does not declare a workspace. */
export function formatRecursionWithoutWorkspace(root: string): string {
  return `-R/--recursive needs a pnpm workspace: ${describeAbsence(root)}`;
}

// region | Helpers

/** Returns the clause naming where nmr looked for the manifest. */
function describeAbsence(root: string): string {
  return `no ${WORKSPACE_MANIFEST} in ${root} or any parent directory.`;
}

// endregion | Helpers
