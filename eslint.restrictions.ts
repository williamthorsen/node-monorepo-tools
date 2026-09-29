const SCAFFOLD_MESSAGE =
  "Scaffold through the temporary tree's own `write`, `writeJson`, `writeAll`, `mkdir`, or `symlink`, which create parent directories, refuse a path outside the tree, and return the path written. If the tree's API does not fit, disable this rule on the line and say why.";

const SYNC_SCAFFOLD_NAMES = '/^(mkdirSync|writeFileSync|symlinkSync)$/';

const scaffoldingRestrictions = [
  {
    selector: `CallExpression:matches([callee.name=${SYNC_SCAFFOLD_NAMES}], [callee.property.name=${SYNC_SCAFFOLD_NAMES}])`,
    message: SCAFFOLD_MESSAGE,
  },
  {
    // The promises and callback forms name `mkdir` and `symlink` as the tree does, so a property-name match on
    // those would report the very API that the message recommends; they are restricted in the bare-call form that a
    // named import produces. Because the tree's method is `write`, `writeFile` does not collide with it; its member
    // form is restricted too, and `fsp.writeFile` is caught alongside it.
    selector:
      'CallExpression:matches([callee.name=/^(mkdir|writeFile|symlink)$/], [callee.property.name=/^writeFile$/])',
    message: SCAFFOLD_MESSAGE,
  },
];

/**
 * Syntax restricted everywhere in the repository. Every block raising `no-restricted-syntax` spreads this list
 * instead of restating it, because ESLint replaces a rule's options rather than merging them.
 */
export const syntaxRestrictions = [
  // The base config's own entries, which the spread would otherwise drop.
  'DebuggerStatement',
  'LabeledStatement',
  'WithStatement',
  {
    // Matches on the operator rather than the binding's name, so `err` and `e` are caught too. Because
    // `isError` recognizes an Error crossing a realm boundary, which the built-in test reports as false,
    // the restriction applies in every position.
    selector: "BinaryExpression[operator='instanceof'][right.name='Error']",
    message:
      "Test a thrown value's errno with `hasErrnoCode` from '@williamthorsen/nmr-core'; otherwise narrow it with `isError`, or extract its message with `describeError`, from '@williamthorsen/toolbelt.errors'.",
  },
];

/**
 * Everything restricted in test code: the repo-wide set, plus the `node:fs` calls that scaffold a temporary
 * directory by hand, which the tree's own API does in one call. Composed here rather than at the config's call
 * site, because dropping half of it there disables the repo-wide set for test code with nothing to report it.
 */
export const testCodeRestrictions = [...syntaxRestrictions, ...scaffoldingRestrictions];
