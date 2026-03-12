# Bug: Typechecking fails: TSConfig may not disable emit

## Problem

Typechecking failed in `packages/react` with error:

```
tsconfig.json(22,5): error TS6310: Referenced project '~/repos/templates/node-monorepo/packages/react/tsconfig.node.json' may not disable emit.
```

## Investigation

1. **Configuration mismatch**: `tsconfig.node.json` had `"composite": true` requiring emit enabled, but was referenced as project with emit disabled
2. **Purpose analysis**: `tsconfig.node.json` intended for Node.js environment code (like `vite.config.ts`) separate from browser code
3. **Comparison**: Svelte package had similar setup but without extending main tsconfig
4. **Experimental deletion**: Removed `tsconfig.node.json` and project reference entirely

## Findings

- React app runs in development and builds in production without `tsconfig.node.json`
- No type errors occur with single `tsconfig.json` configuration
- Modern Vite handles `vite.config.ts` compilation without separate Node.js TypeScript config
- The multiple tsconfig pattern was unnecessary overhead for this monorepo setup

## Resolution

Removed:

- `packages/react/tsconfig.node.json` file
- Project reference from `packages/react/tsconfig.json`

Result: Typechecking now passes, all functionality preserved.
