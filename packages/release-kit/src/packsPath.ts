/**
 * Reports whether npm would place `path` in the published tarball, given a package.json `files` value.
 *
 * npm packs everything when the `files` value is absent or malformed, and `packsPath` reports `true`; for an empty
 * array, npm packs only the files that it always includes, and `packsPath` reports `false`. An entry naming an
 * ancestor directory covers everything beneath it, which is how `files: ["dist/*"]` includes `dist/esm/index.js`, so
 * `packsPath` tests every ancestor prefix of `path` rather than `path` alone.
 *
 * Two approximations of npm's packing rules remain, both failing toward a silent pass: A negation entry
 * (`!dist/*.map`) never counts toward inclusion, because gitignore-style ordered negation is not modeled; and for a
 * repo controlling its tarball through `.npmignore` alone, which does not declare a `files` field, `packsPath`
 * reports `true` without reading the ignore file. For a check that warns about an omission, a missed report does
 * less harm than a false one.
 */
export function packsPath(filesField: unknown, path: string): boolean {
  if (!isStringArray(filesField)) return true;

  const prefixes = listAncestorPrefixes(path);
  return filesField.some((entry) => {
    const pattern = compileEntry(entry);
    return pattern !== undefined && prefixes.some((prefix) => pattern.test(prefix));
  });
}

/** Splits a glob into its metacharacters and the literal runs between them. */
const GLOB_TOKEN_PATTERN = /\*\*\/|\*\*|\*|\?|[^*?]+/g;

// region | Helpers

/**
 * Compiles one `files` entry into an anchored pattern, or `undefined` when the entry can include nothing.
 *
 * Strips the leading `./` or `/` and the trailing `/` that npm ignores, and rejects a negation entry.
 */
function compileEntry(entry: string): RegExp | undefined {
  if (entry.startsWith('!')) return undefined;

  const normalized = entry.replace(/^\.?\//, '').replace(/\/+$/, '');
  if (normalized === '') return undefined;

  return new RegExp(`^${translateGlob(normalized)}$`);
}

/** Narrows an `unknown` value to `string[]`. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Lists `path` and every directory above it, so that an entry matching an ancestor also matches the file beneath it.
 */
function listAncestorPrefixes(path: string): string[] {
  const segments = path.split('/');
  return segments.map((_segment, index) => segments.slice(0, index + 1).join('/'));
}

/**
 * Translates a glob into regex source, where `**` spans path separators and `*` and `?` stop at one.
 *
 * A leading globstar segment also matches nothing, so a pattern of two stars, a slash, and `*.json` covers a file
 * at the package root as well as one nested below it.
 */
function translateGlob(pattern: string): string {
  let source = '';
  for (const [token] of pattern.matchAll(GLOB_TOKEN_PATTERN)) {
    switch (token) {
      case '**/':
        source += String.raw`(?:[^/]*\/)*`;
        break;
      case '**':
        source += '.*';
        break;
      case '*':
        source += '[^/]*';
        break;
      case '?':
        source += '[^/]';
        break;
      default:
        source += RegExp.escape(token);
    }
  }
  return source;
}

// endregion | Helpers
