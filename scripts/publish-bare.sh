#!/usr/bin/env bash
set -euo pipefail

# publish-bare.sh — Bootstrap publish a placeholder package to npm.
#
# A new package on npm needs a one-time placeholder publish so its name is
# registered before `npm trust` can be configured. Once trust is in place,
# every subsequent version ships through `.github/workflows/publish.yaml` on
# tag pushes.
#
# This script publishes a minimal `name@0.0.0` placeholder containing only
# `package.json` and `README.md`. The working repo is never mutated — the
# placeholder is built in `mktemp -d` and removed via `trap` on exit.

PROG="$(basename "$0")"
readonly PROG
readonly NAME_REGEX='^(@[a-z0-9][a-z0-9_.-]*/)?[a-z0-9][a-z0-9_.-]*$'
readonly MAX_NAME_LEN=214

# Cleanup state — accessed by EXIT trap after main() returns.
tmp=""

# Validates the name and the npm session, builds the placeholder, and publishes it after confirmation.
main() {
  local name=""
  local dry_run=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
    -h | --help) show_usage 0 ;;
    --dry-run) dry_run=true ;;
    -*)
      echo "$PROG: unknown option '$1'" >&2
      show_usage
      ;;
    *)
      if [[ -n "$name" ]]; then
        echo "$PROG: too many positional arguments (expected one package name)" >&2
        show_usage
      fi
      name="$1"
      ;;
    esac
    shift
  done

  if [[ -z "$name" ]]; then
    echo "$PROG: missing package name" >&2
    show_usage
  fi

  # Preflight: cheap-to-expensive
  validate_name "$name"
  require_npm
  require_login
  require_name_available "$name"

  # Build placeholder in a temp directory; trap before any further work
  tmp="$(mktemp -d)"
  trap cleanup EXIT

  build_placeholder "$tmp" "$name"
  print_summary "$tmp" "$name" "$dry_run"

  if "$dry_run"; then
    echo "DRY RUN — nothing was published." >&2
    exit 0
  fi

  confirm_publish

  (cd "$tmp" && npm publish --access public)
  echo "$PROG: published $name@0.0.0" >&2
}

# region | Helper functions

# Prints usage to stderr and exits with the given code, 1 by default.
show_usage() {
  cat >&2 <<USAGE
Bootstrap publish a placeholder package to npm.

Usage:
  $PROG <package-name>
  $PROG <package-name> --dry-run
  $PROG --help

Arguments:
  <package-name>    Scoped or unscoped npm package name (required)

Options:
  --dry-run         Run all preflight checks and build the placeholder, but
                    skip the actual 'npm publish'.
  -h, --help        Show this help and exit 0.

Dependencies:
  npm               npm CLI must be on PATH and the user must be logged in.

Examples:
  $PROG my-pkg
  $PROG @williamthorsen/my-pkg --dry-run
USAGE
  exit "${1:-1}"
}

# Rejects a name that exceeds npm's length limit or falls outside its character set.
validate_name() {
  local name="$1"
  if [[ ${#name} -gt $MAX_NAME_LEN ]]; then
    echo "$PROG: package name exceeds $MAX_NAME_LEN characters" >&2
    exit 1
  fi
  if [[ ! "$name" =~ $NAME_REGEX ]]; then
    echo "$PROG: invalid npm package name: '$name'" >&2
    echo "Names must start with a lowercase letter or digit, then contain only lowercase letters, digits, hyphens, dots, and underscores; optional '@scope/' prefix." >&2
    exit 1
  fi
}

# Requires the npm CLI on PATH.
require_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "$PROG: required command 'npm' not found on PATH" >&2
    exit 127
  fi
}

# Requires the user to be logged in to npm.
require_login() {
  if ! npm whoami >/dev/null 2>&1; then
    echo "$PROG: not logged in to npm" >&2
    echo "Log in with: npm login" >&2
    exit 1
  fi
}

# Requires the package name to be free on the npm registry, telling a 404 (free) apart from any other error (registry
# unreachable).
require_name_available() {
  local name="$1"
  local view_stderr=""
  local view_rc=0

  view_stderr="$(npm view --json "$name" version 2>&1 1>/dev/null)" || view_rc=$?

  if [[ $view_rc -eq 0 ]]; then
    echo "$PROG: package '$name' already exists on the npm registry" >&2
    exit 1
  fi

  # Match any "404" (not just "E404"): npm has emitted multiple formats across versions.
  if [[ "$view_stderr" != *"404"* ]]; then
    echo "$PROG: failed to query npm registry for '$name'" >&2
    echo "$view_stderr" >&2
    exit 1
  fi
}

# Writes the placeholder package.json and README.md into the temp dir.
build_placeholder() {
  local tmp="$1"
  local name="$2"
  cat >"$tmp/package.json" <<JSON
{
  "name": "$name",
  "version": "0.0.0"
}
JSON
  cat >"$tmp/README.md" <<README
Placeholder for \`$name\` — awaiting first release.
README
}

# Prints a summary of what the run publishes, or would publish under --dry-run.
print_summary() {
  local tmp="$1"
  local name="$2"
  local dry_run="$3"
  local mode="real publish"
  if "$dry_run"; then
    mode="dry-run"
  fi
  cat >&2 <<SUMMARY

Bootstrap publish summary:
  Package:  $name
  Version:  0.0.0
  Access:   public
  Files:    package.json, README.md
  Source:   $tmp
  Mode:     $mode

SUMMARY
}

# Prompts for confirmation, exiting 0 on any answer other than y/Y.
confirm_publish() {
  local ans=""
  read -rp "Publish? [y/N] " ans || ans=""
  if [[ "$ans" != "y" && "$ans" != "Y" ]]; then
    echo "$PROG: publish cancelled" >&2
    exit 0
  fi
}

# Removes the placeholder files, then the temp dir if it is empty. Removing files by name avoids `rm -rf` on a path
# that the script constructs.
cleanup() {
  [[ -n "${tmp:-}" && -d "$tmp" ]] || return 0
  rm -f -- "$tmp/package.json" "$tmp/README.md"
  rmdir -- "$tmp" 2>/dev/null || true
}

# endregion | Helper functions

main "$@"
