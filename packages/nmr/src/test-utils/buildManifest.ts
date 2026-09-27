/** Renders a workspace manifest for the fixture package `@fixture/tool`, with the given fields beside its name. */
export function buildManifest(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ name: '@fixture/tool', ...fields }, undefined, 2)}\n`;
}
