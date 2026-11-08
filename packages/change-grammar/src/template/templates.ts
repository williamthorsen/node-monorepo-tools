/**
 * The subject templates of the conventions that the engine includes. Each names the shape of a commit subject; a
 * surface that decorates one with a ticket reference or a pull-request number wraps it in groups of its own.
 */
export const TEMPLATE_CATALOGUE = {
  bracketedScope: String.raw`[\[{scope}\] ]{type}{breaking}: {title}`,
  conventionalCommits: '{type}[({scope})]{breaking}: {title}',
  pipedScope: '[[{scope}|]{type}: ]{title}',
  typeOnly: '{type}{breaking}: {title}',
} as const;

/** The name of a convention declared by the catalogue. */
export type ConventionName = keyof typeof TEMPLATE_CATALOGUE;
