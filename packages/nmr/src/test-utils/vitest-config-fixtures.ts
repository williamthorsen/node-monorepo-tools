import { fileURLToPath } from 'node:url';

import { defaultClientConditions, defaultServerConditions } from 'vite';
import type { TestProjectConfiguration, TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';

// Composed from Vite's own exports rather than spelled out, so that a release that changes either default list fails
// every assertion reading one, rather than leaving the config to narrow resolution silently.
export const CLIENT_CONDITIONS = [...defaultClientConditions];

export const GIT_ISOLATION_SETUP_FILE = fileURLToPath(new URL('../vitest-git-isolation.ts', import.meta.url));

/** Every project declared by the shared config, in the order it emits them: the residual, then the ladder. */
export const PROJECT_NAMES = ['unit', 'tool', 'localhost', 'remote'];

export const SERVER_CONDITIONS = [...defaultServerConditions];

// Spelled out rather than derived from the config, so that the assertion fails if the derivation itself drifts.
export const TIERED_PATTERNS = [
  '**/__tests__/**/*.tool.test.{ts,tsx}',
  '**/__tests__/**/*.localhost.test.{ts,tsx}',
  '**/__tests__/**/*.remote.test.{ts,tsx}',
];

/** Narrows the declared projects to the inline form, which is the only form that the factories emit. */
export function getProjects(config: ViteUserConfig): TestProjectInlineConfiguration[] {
  return (config.test?.projects ?? []).filter(isInlineProject);
}

// region | Helpers

/** Reports whether a project entry is an inline configuration rather than a path or a pending import. */
function isInlineProject(project: TestProjectConfiguration): project is TestProjectInlineConfiguration {
  return typeof project === 'object' && !(project instanceof Promise);
}

// endregion | Helpers
