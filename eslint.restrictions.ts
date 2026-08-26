const SCAFFOLD_MESSAGE =
  "Scaffold through the temporary tree's own `write`, `writeJson`, `writeAll`, `mkdir`, or `symlink`, which create parent directories, refuse a path outside the tree, and return the path written. Where the tree's API does not fit, disable this rule on the line and say why.";

const SYNC_SCAFFOLD_NAMES = '/^(mkdirSync|writeFileSync|symlinkSync)$/';

/**
 * Syntax restricted everywhere in the repository. ESLint replaces a rule's options rather than merging them, so
 * every block raising `no-restricted-syntax` spreads this list instead of restating it.
 */
export const syntaxRestrictions = [
  // The base config's own entries, which the spread would otherwise drop.
  'DebuggerStatement',
  'LabeledStatement',
  'WithStatement',
  {
    // Matches on the operator rather than the binding's name, so `err` and `e` are caught too. `isError`
    // recognizes an Error crossing a realm boundary, which the built-in test reports as false, so no
    // position is exempt.
    selector: "BinaryExpression[operator='instanceof'][right.name='Error']",
    message:
      "Test a thrown value's errno with `hasErrnoCode` from '@williamthorsen/nmr-core'; otherwise narrow it with `isError`, or extract its message with `describeError`, from '@williamthorsen/toolbelt.errors'.",
  },
];

/**
 * Syntax restricted in test files alone: the `node:fs` calls that scaffold a temporary directory by hand, which
 * the tree's own API does in one call.
 */
export const testScaffoldingRestrictions = [
  {
    selector: `CallExpression:matches([callee.name=${SYNC_SCAFFOLD_NAMES}], [callee.property.name=${SYNC_SCAFFOLD_NAMES}])`,
    message: SCAFFOLD_MESSAGE,
  },
  {
    // The promises and callback forms share their names with the tree's `mkdir`, `write`, and `symlink`, so a
    // property-name match here would report the very API the message recommends. Only the bare-call form, which
    // a named import from `node:fs/promises` produces, is restricted.
    selector: 'CallExpression[callee.name=/^(mkdir|writeFile|symlink)$/]',
    message: SCAFFOLD_MESSAGE,
  },
];
