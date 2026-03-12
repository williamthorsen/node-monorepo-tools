# PNPM Node monorepo

## Getting started

This project uses [pnpm](https://github.com/pnpm/pnpm) and NodeJS. The versions of each are set in `.tool-versions`.

If you don't have PNPM installed, it is recommended that you use the [ASDF runtime manager](https://asdf-vm.com/) to install it. For alternative methods, see the [pnpm installation instructions](https://pnpm.io/installation).

```shell
# Install ASDF runtime-version manager
git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.10.2
# OR (not tested)
brew install asdf

# Install PNPM
asdf plugin add pnpm
asdf install pnpm 7.21.0
```

You can also use ASDF to install the correct version of Node:

```shell
asdf plugin add nodejs
asdf install nodejs 18.12.1
```

## Scripts

Install dependencies (this script has the same effect regardless of where it is run in the project):

```shell
pnpm install
```

---

These commands can be run at the project level or at the level of an individual package (i.e., the simulator API or the Svelte app).

To run at the project level, run the command from the project root. To run at a package level, change to the package's directory. Example: `cd packages/svelte`.

Run all code checks:

```shell
pnpm run check
```

Run the typechecker

```shell
pnpm run typecheck
```

Run the linter:

```shell
pnpm run lint
# OR check for lint and fix issues that can be automatically
pnpm run lint:fix
```

Run tests:

```shell
# Test and watch for changes
pnpm test

# Run tests once
pnpm run test:run

# Run coverage checker
pnpm run test:coverage
```

Shortcut to run typechecking, linting, and tests:

```shell
pnpm run check
```

Check for outdated dependencies (entire monorepo):

```shell
# Check for updates compatible with the current version ranges
pnpm run outdated
# Check for latest versions
pnpm run outdated:latest
```

Upgrade dependencies (entire monorepo):

```shell
# Update dependencies compatible with the current version ranges
pnpm run update
# Update to the latest versions
pnpm run update:latest
```

Upgrade transitive dependencies (entire monorepo):

```shell
pnpm upgrade
```
