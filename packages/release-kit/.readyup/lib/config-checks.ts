import type { CheckOutcome } from 'readyup';
import { discoverWorkspaces, readFile } from 'readyup/check-utils';

/** Source shapes that can put `default` or `config` on the module namespace, which is what `loadConfig` reads. */
const CONFIG_EXPORT_PATTERNS = [
  /export\s+default\b/,
  /export\s+(?:const|let|var)\s+config\b/,
  /export\s*\{[^}]*\b(?:config|default)\b[^}]*\}/,
  /export\s*\*/,
];

/**
 * Checks that the config file exports a config that release-kit can load.
 *
 * `loadConfig` resolves `imported.default ?? imported.config` and throws when the file exports neither, so the
 * checks nested beneath this one have nothing to read until it passes. Because source text cannot decide a module's
 * export names exactly, and this check gates five others at `error` severity, the patterns match broadly: A config
 * that the patterns admit and `loadConfig` rejects produces one failure downstream, whereas the reverse suppresses
 * the seven checks beneath this one.
 */
export function configFileExportsConfig(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return false;
  return CONFIG_EXPORT_PATTERNS.some((pattern) => pattern.test(content));
}

/** Checks whether `.github/labels.yaml` contains the expected hash for a named preset. */
export function labelsHaveCurrentPresetHash(presetName: string, expectedHash: string): boolean {
  const content = readFile('.github/labels.yaml');
  if (content === undefined) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, 'm');
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}

/**
 * Tests whether a README's content contains the release-notes section marker pair.
 *
 * Both `<!-- section:release-notes -->` and `<!-- /section:release-notes -->` must be present.
 * Order and proximity are not enforced; release-kit's injector locates each marker independently.
 */
export function readmeHasReleaseNotesMarkers(content: string): boolean {
  return content.includes('<!-- section:release-notes -->') && content.includes('<!-- /section:release-notes -->');
}

/**
 * Checks that the README of every publishable workspace contains the release-notes markers.
 *
 * A missing README counts as a failure for its package. Workspace discovery reports the repo root in both repo types,
 * so a publishable root is checked like any other package.
 */
export function readmesHaveReleaseNotesMarkers(): boolean | CheckOutcome {
  const failing: string[] = [];
  const packageWorkspaces = discoverWorkspaces({ filter: (w) => w.isPackage });
  for (const { dir } of packageWorkspaces) {
    const readmePath = dir === '.' ? 'README.md' : `${dir}/README.md`;
    const content = readFile(readmePath);
    if (content === undefined || !readmeHasReleaseNotesMarkers(content)) {
      failing.push(readmePath);
    }
  }

  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `missing markers or README: ${failing.join(', ')}`,
  };
}

/**
 * Checks that releaseNotes features are not enabled while changelogJson is disabled.
 *
 * Uses regex matching against the raw config file to avoid importing it.
 */
export function releaseNotesConfigIsConsistent(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return true;

  const changelogJsonDisabled = /changelogJson\s*:\s*\{[^}]*enabled\s*:\s*false/.test(content);
  if (!changelogJsonDisabled) return true;

  const hasReadmeInjection = /shouldInjectIntoReadme\s*:\s*true/.test(content);
  return !hasReadmeInjection;
}

/** Checks that `releaseNotes.shouldInjectIntoReadme` is explicitly set to true. */
export function releaseNotesInjectsIntoReadme(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return false;
  return /shouldInjectIntoReadme\s*:\s*true/.test(content);
}

/**
 * Checks that every `scope:` label in `.github/labels.yaml` has an empty description.
 *
 * Parses the file line by line: `sync-labels generate` writes each label as a `- name:` line followed by indented
 * fields, and spells an absent description `''`. A missing file passes, because the parent check reports it.
 */
export function scopeLabelsHaveNoDescriptions(): boolean | CheckOutcome {
  const content = readFile('.github/labels.yaml');
  if (content === undefined) return true;

  const described: string[] = [];
  let currentName: string | undefined;
  for (const line of content.split('\n')) {
    const nameMatch = /^- name:\s*(.*?)\s*$/.exec(line);
    if (nameMatch) {
      currentName = stripYamlQuotes(nameMatch[1] ?? '');
      continue;
    }
    const descriptionMatch = /^\s+description:\s*(.*?)\s*$/.exec(line);
    if (descriptionMatch && currentName?.startsWith('scope:') && stripYamlQuotes(descriptionMatch[1] ?? '') !== '') {
      described.push(currentName);
    }
  }

  if (described.length === 0) return true;
  return {
    ok: false,
    detail: `scope labels with a description: ${described.join(', ')}`,
  };
}

// region | Helpers

/** Removes one level of matching single or double quotes from a YAML scalar. */
function stripYamlQuotes(value: string): string {
  const match = /^(['"])(.*)\1$/.exec(value);
  return match?.[2] ?? value;
}

// endregion | Helpers
