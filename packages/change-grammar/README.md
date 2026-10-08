<!-- readme-type: library -->

# @williamthorsen/change-grammar

Renders change records as subject lines, such as commit titles, and parses them back from the same template.

The package does not have any dependencies and does not read anything from its environment, so it runs anywhere that JavaScript does.

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

```bash
pnpm add @williamthorsen/change-grammar
```

## Usage

```ts
import { CANONICAL_TAXONOMY, compileTemplate, parse, render, TEMPLATE_CATALOGUE } from '@williamthorsen/change-grammar';

const nodes = compileTemplate(TEMPLATE_CATALOGUE.conventionalCommits);
render(nodes, { scope: 'nmr', title: 'Add a flag', type: 'feat' }); // 'feat(nmr): Add a flag'
parse(nodes, 'feat(nmr): Add a flag', CANONICAL_TAXONOMY); // { scope: 'nmr', title: 'Add a flag', type: 'feat' }
```

## API

- **Templates:** `compileTemplate` turns a template such as `{type}[({scope})]{breaking}: {title}` into nodes, `verify` reports every reason a template cannot round-trip, and `findLossyRenders` reports each record shape, admitted by the template's optional groups, whose render does not read back as that record; such a shape warrants a warning, not a refusal. `TEMPLATE_CATALOGUE` declares the templates of four common conventions.
- **Records:** `render` writes a `ChangeRecord` through a compiled template, and `parse` reads one back, resolving type aliases through the taxonomy. `normalizeChangeRecord`, `applyOverrides`, `consolidate`, and `validate` prepare, adjust, merge, and check records; `splitScopes` and `dropIncidentalRoot` work on scope lists.
- **Taxonomy:** `CANONICAL_TAXONOMY` is the shared work-type taxonomy, typed as `CanonicalTaxonomy`. Every engine function that takes a taxonomy accepts it, or any object of the narrower `Taxonomy` shape; `deriveLabelMap` also needs each type's `trackerLabel`.
- **Label map:** `deriveLabelMap(taxonomy, workspaces)` returns the tracker labels for each work type and each workspace scope.

## Label-map schema

The package publishes a JSON Schema for label-map files, which a file references from its `$schema` field:

```text
https://github.com/williamthorsen/node-monorepo-tools/raw/change-grammar-v<version>/packages/change-grammar/schemas/label-map.json
```
