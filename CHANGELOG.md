# node-monorepo

## 1.3.0

### Refactoring

- Aligned tooling & conventions with latest projects

## 1.2.6

### Dependencies

- Upgraded all dependencies to latest version

## 1.2.5

### Dependencies

- Upgraded all dependencies to latest version

## 1.2.4

### Dependencies

- Upgraded all dependencies to latest version

## 1.2.3

### Tooling

- Automated the resolution of TypeScript aliases in Vitest by adding `vite-config-paths` to the Vitest config.

### Dependencies

- Upgraded all deps to latest version

## 1.2.1

### Dependencies

- Upgraded all dependencies to latest version
- Updated all runtimes to latest minor version

## 1.2.0

### Tooling

- Added a `chrome` workspace to the monorepo

## 1.1.0

### Dependencies

- Upgraded all dependencies to the latest version

### Refactoring

- Fixed lint in scripts caused by stricter linting rules and dependency upgrades

## 1.0.9

### Tooling

- Removed shebang from `scripts/run-workspace-script`; it is now run through `tsx`

### Dependencies

- Upgraded all dependencies to latest version

## 1.0.6

### Tooling

Removed unneeded type guards from Vitest configuration files.

### Dependencies

Upgraded all dependencies to latest minor version.

Upgraded all runtimes to latest version but downgraded Node.js runtime to latest v18.x.x, because AWS CDK does not yet support v20.

## 1.0.2

### Dependencies

- Upgraded all dependencies to latest version
- Replaced `c8` with Vitest's `v8` coverage engine

### Utility

- Added a `strict-lint.ts` script to treat all linter warnings as errors

### Tooling

- Added an audit wrapper to allow whitelisting of vulnerabilities
- Simplified Vitest configs
- Added `lint:strict` manifest script
- Added strict linting and coverage checking to the `check` manifest script

## 1.0.1

### Dependencies

- Upgraded all deps to latest version
