# Authoring nmr's agent guidance

This directory is a CodeAssembly content root, declared by the `codeassembly.content` key in `packages/nmr/package.json`.

## The ambient cheatsheet

`guidance/rulebooks/nmr.md` carries `delivery: ambient`, so its body is injected at launch in every consuming repo. Every line is paid for on every task, whether or not it is relevant. It is a cheatsheet, not a manual.

A line earns a place in it only if both hold:

1. **It is absent from nmr's own output.** Bare `nmr` already prints the flags, every command, and the shell command each resolves to; failing checks already name their own fix. Repeating any of that costs launch tokens to say something the agent will be told anyway, at the moment it matters.
2. **The obvious action goes wrong without it.** Guidance that prevents a silent mistake earns its place; guidance that prevents a mistake the next error message would diagnose does not.

Everything else belongs in `packages/nmr/README.md`, reachable on demand at `node_modules/@williamthorsen/nmr/README.md`, with a pointer from the cheatsheet naming the topic so an agent knows to look. When adding a feature, document it there and extend that pointer rather than the cheatsheet.

## Constraints on rulebook bodies

Rulebook bodies carry no links to other rulebooks. CodeAssembly's renderer rewrites link targets under `skills/` and `scripts/` and rejects everything else, so a cross-reference names the deployed `consult-<slug>` in prose and declares the edge under `dependencies:`.

Anchor-only links are checked against the body they appear in, so a fragment naming a heading that lives in another document fails the run. Check `](#` before moving a section between bodies.

## Publishing

The directory is published because `files` in `packages/nmr/package.json` lists it. Dropping that entry fails nothing locally, because this repo resolves the guidance through a `workspace:*` self-link that `files` does not govern. `packaging.tool.test.ts` is what catches it.
