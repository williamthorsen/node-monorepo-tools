# node-monorepo-cdk-template

## 1.3.0

### Refactoring

- Aligned tooling & conventions with latest projects

## 1.2.6

### Dependencies

- Upgraded all dependencies to latest version

## 1.2.5

### Dependencies

- Upgraded all dependencies to latest version

### Tooling

- Rationalized the `.gitignore` to support Prettier

## 1.2.4

### Dependencies

- Upgraded all dependencies to latest version

## 1.2.3

### Dependencies

- Upgraded all dependencies to latest version

## 1.2.2

### Dependencies

- Upgraded all dependencies to latest version

### Refactoring

- Fixed lint issues triggered by stricter linting rules and dependency upgrades

## 1.2.1

### Dependencies

- Upgraded all dependencies to latest version

### Tooling

- Modify `ws` script to support module resolution after runtime upgrades

## 1.1.0

### Dependencies

- Upgraded all dependencies to latest version
- Added `tsx` to dev dependencies to replace `npx ts-node`

### Tooling

- Replaced `npx ts-node` with `tsx` in scripts
- Modified `tsconfig.json`:
  - Added `esModuleInterop: true` to fix type-checking broken by dependency upgrades
  - Removed `moduleDetection: 'force'` because it appears to be unnecessary

### Refactoring

- Added type annotations to satisfy stricter type-checking

## 1.0.9

### Dependencies

- Upgraded all dependencies to latest version

## 1.0.8

### Dependencies

- Upgraded dependencies

## 1.0.7

### Dependencies

- Upgraded all dependencies to latest version

## 1.0.6

### Tooling

Added `.dist/` to `.gitignore`.

Added `development` as argument to `build` package script to avoid build error.

Set `context.appName="placeholder"` in `cdk.json` to avoid build error.

### Dependencies

- Upgraded all dependencies to latest minor version.

## 1.0.5

### Dependencies

- Upgraded all dependencies to latest version

## 1.0.4

### Dependencies

- Upgraded all dependencies to latest version

## 1.0.3

### Dependencies

- Upgraded all dependencies

### Tooling

- Simplified test configurations

## 1.0.2

### Dependencies

- Upgraded all dependencies to latest version

### Tooling

- Simplified Vitest configs
- Added `lint:strict` manifest script
- Added strict linting and coverage checking to the `check` manifest script

## 1.0.1

### Dependencies

- Upgraded all dependencies to latest version
