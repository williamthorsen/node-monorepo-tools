/**
 * The subject templates of the four conventions that the engine ships with. Each names the shape of a commit subject; a
 * surface that decorates one with a ticket reference or a pull-request number wraps it in groups of its own.
 *
 * `pipedScope` separates the scope from the type with a pipe and names no `{breaking}`, so the marker follows the type,
 * as in `feat!`. The other three name `{breaking}` and place the marker immediately before the colon, which is the
 * position release-kit reads. Because `pipedScope` nests its scope group inside its type group, a change that names no
 * scope keeps its type prefix.
 */
export const TEMPLATE_CATALOGUE = {
  bracketedScope: String.raw`[\[{scope}\] ]{type}{breaking}: {title}`,
  conventionalCommits: '{type}[({scope})]{breaking}: {title}',
  pipedScope: '[[{scope}|]{type}: ]{title}',
  typeOnly: '{type}{breaking}: {title}',
} as const;

/** The name of a convention declared by the catalogue. */
export type ConventionName = keyof typeof TEMPLATE_CATALOGUE;
