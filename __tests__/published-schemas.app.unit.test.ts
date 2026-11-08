import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRecord } from '../packages/nmr-core/src/portable/isRecord.ts';

const repoRoot = resolve(import.meta.dirname, '..');
const schemaPaths = listPublishedSchemaPaths();
const referencingPaths = listReferencingDirectories().flatMap(listJsonPaths);

// eslint-disable-next-line unicorn/prefer-https -- draft-07's meta-schema $id is canonically http; it identifies the schema, it is not fetched
const DRAFT_07_URI = 'http://json-schema.org/draft-07/schema#';

/** Keywords that later drafts introduced, which a draft-07 validator ignores rather than applies. */
const POST_DRAFT_07_KEYWORDS = new Set([
  '$anchor',
  '$defs',
  '$dynamicAnchor',
  '$dynamicRef',
  '$recursiveAnchor',
  '$recursiveRef',
  '$vocabulary',
  'dependentRequired',
  'dependentSchemas',
  'maxContains',
  'minContains',
  'prefixItems',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

/** Keywords whose value maps property names to subschemas. */
const NAMED_SUBSCHEMA_KEYWORDS = new Set(['definitions', 'dependencies', 'patternProperties', 'properties']);

/** Keywords whose value is a subschema or an array of subschemas. */
const SUBSCHEMA_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'allOf',
  'anyOf',
  'contains',
  'else',
  'if',
  'items',
  'not',
  'oneOf',
  'propertyNames',
  'then',
]);

describe('published JSON Schemas', () => {
  it('finds a schema to check', () => {
    expect(schemaPaths).not.toStrictEqual([]);
  });

  describe.each(schemaPaths.map((path) => [relative(repoRoot, path), path]))('%s', (_label, path) => {
    const schema = readJsonObject(path);

    it('declares draft-07', () => {
      expect(schema['$schema']).toBe(DRAFT_07_URI);
    });

    it('uses only draft-07 keywords', () => {
      expect(collectKeywords(schema).filter((keyword) => POST_DRAFT_07_KEYWORDS.has(keyword))).toStrictEqual([]);
    });

    it('does not declare `$id`', () => {
      expect(collectKeywords(schema)).not.toContain('$id');
    });
  });
});

describe("the repo's own schema references", () => {
  const references = referencingPaths.flatMap((path) => {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const reference = isRecord(parsed) ? parsed['$schema'] : undefined;
    return typeof reference === 'string' && namesRepoSchema(reference) ? [[relative(repoRoot, path), reference]] : [];
  });

  it('finds a reference to check', () => {
    expect(references).not.toStrictEqual([]);
  });

  it.each(references)('%s references a published schema in the working tree', (path, reference) => {
    expect(reference).not.toMatch(/^[a-z]+:\/\//);
    expect(schemaPaths).toContain(resolve(repoRoot, dirname(path), reference));
  });
});

// region | Helpers

/**
 * Returns every keyword that appears in a schema position, descending into subschemas. The keys of a
 * `NAMED_SUBSCHEMA_KEYWORDS` value are property names rather than keywords, so only its values are visited.
 */
function collectKeywords(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectKeywords);
  if (!isRecord(node)) return [];

  return Object.entries(node).flatMap(([keyword, value]) => [keyword, ...collectNestedKeywords(keyword, value)]);
}

/** Returns the keywords inside the value of `keyword`, which are none unless the value holds subschemas. */
function collectNestedKeywords(keyword: string, value: unknown): string[] {
  if (NAMED_SUBSCHEMA_KEYWORDS.has(keyword) && isRecord(value)) {
    return Object.values(value).flatMap(collectKeywords);
  }
  return SUBSCHEMA_KEYWORDS.has(keyword) ? collectKeywords(value) : [];
}

/** Returns the absolute paths of the JSON files directly inside `directory`, sorted. */
function listJsonPaths(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(directory, name))
    .toSorted();
}

/** Returns the absolute path of every `packages/*\/schemas/*.json`, sorted. */
function listPublishedSchemaPaths(): string[] {
  const packagesDirectory = join(repoRoot, 'packages');
  return readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const schemasDirectory = join(packagesDirectory, entry.name, 'schemas');
      try {
        return listJsonPaths(schemasDirectory);
      } catch {
        return [];
      }
    })
    .toSorted();
}

/** Returns the absolute paths of the root `.config` and `.meta` directories and of every `packages/*\/.meta`. */
function listReferencingDirectories(): string[] {
  const packagesDirectory = join(repoRoot, 'packages');
  const packageMetaDirectories = readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDirectory, entry.name, '.meta'))
    .filter((directory) => existsSync(directory))
    .toSorted();
  return [join(repoRoot, '.config'), join(repoRoot, '.meta'), ...packageMetaDirectories];
}

/** Reports whether a `$schema` value names a schema of this repo: a relative path, or a URL into this repo. */
function namesRepoSchema(reference: string): boolean {
  return !/^[a-z]+:\/\//.test(reference) || reference.includes('williamthorsen/node-monorepo-tools/');
}

/** Reads a JSON file that must contain an object. */
function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) {
    throw new TypeError(`${relative(repoRoot, path)} must contain a JSON object`);
  }
  return parsed;
}

// endregion | Helpers
