#!/usr/bin/env bash
set -euo pipefail

# migrate-tag-prefixes.sh — Create annotated-tag aliases that bridge a
# monorepo tag-prefix change.
#
# Release-kit derives tag prefixes from the unscoped `package.json` name.
# When a repo migrates to that scheme from the prior directory-basename
# scheme, tags already pushed under the old prefix (e.g., `core-v0.2.7`)
# become invisible to release-kit. This script creates additive annotated-tag
# aliases under the new prefix (e.g., `node-monorepo-core-v0.2.7`) that point
# at the same commits, preserving the original annotation.
#
# The migration is additive and reversible — original tags are left in place.
#
# Usage:
#   migrate-tag-prefixes.sh apply [--dry-run] [--only <dir>] [--force]
#   migrate-tag-prefixes.sh push  [--dry-run] [--only <dir>]
#   migrate-tag-prefixes.sh --help
#
# Dependencies:
#   bash >= 4, git, node (with release-kit's dependencies installed).

PROG="$(basename "$0")"
readonly PROG
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

# Main flow
main() {
  # Manual help handling must run before option parsing.
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    show_usage 0
  fi

  if [[ $# -lt 1 ]]; then
    echo "$PROG: missing subcommand" >&2
    show_usage
  fi

  local subcommand="$1"
  shift

  case "$subcommand" in
    apply|push) ;;
    -*)
      echo "$PROG: missing subcommand (got option '$subcommand')" >&2
      show_usage
      ;;
    *)
      echo "$PROG: unknown subcommand '$subcommand'" >&2
      echo "Run '$PROG --help' for usage." >&2
      exit 2
      ;;
  esac

  local dry_run=false
  local force=false
  local only=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        dry_run=true
        ;;
      --force)
        if [[ "$subcommand" != "apply" ]]; then
          echo "$PROG: --force is only valid with 'apply'" >&2
          exit 1
        fi
        force=true
        ;;
      --only=*)
        only="${1#*=}"
        ;;
      --only)
        if [[ $# -lt 2 ]]; then
          echo "$PROG: --only requires an argument" >&2
          exit 1
        fi
        only="$2"
        shift
        ;;
      -h|--help)
        show_usage 0
        ;;
      -*)
        echo "$PROG: unknown option '$1'" >&2
        show_usage
        ;;
      *)
        echo "$PROG: unexpected positional argument '$1'" >&2
        show_usage
        ;;
    esac
    shift
  done

  require_deps

  # Discover workspaces as parallel arrays.
  local dirs=()
  # shellcheck disable=SC2034  # new_prefixes is passed by nameref to list_workspaces and run_apply/run_push.
  local new_prefixes=()
  list_workspaces dirs new_prefixes

  # Validate --only after discovery so we can list known workspaces.
  if [[ -n "$only" ]]; then
    if ! contains "$only" "${dirs[@]}"; then
      echo "$PROG: unknown workspace '$only'" >&2
      echo "Known workspaces: ${dirs[*]}" >&2
      exit 1
    fi
  fi

  case "$subcommand" in
    apply)
      run_apply "$dry_run" "$force" "$only" dirs new_prefixes
      ;;
    push)
      run_push "$dry_run" "$only" dirs new_prefixes
      ;;
  esac
}

# region | Helper functions

# Display command-line syntax. Exit code defaults to 1 (error context).
show_usage() {
  cat >&2 <<USAGE
Create annotated-tag aliases under a new monorepo tag prefix.

Usage:
  $PROG apply [--dry-run] [--only <dir>] [--force]
  $PROG push  [--dry-run] [--only <dir>]
  $PROG --help

Subcommands:
  apply   Create annotated-tag aliases in the local repo. Idempotent.
  push    Push already-applied aliases to 'origin'. Requires prior apply.

Options:
  --dry-run      Preview actions without running git tag or git push.
  --only <dir>   Limit to a single workspace (by directory basename).
  --force        (apply only) Replace a local alias that points at a
                 different commit than the original tag.
  -h, --help     Show this help.

Notes:
  - 'apply' creates additive aliases; original tags are left in place.
  - 'push' never runs 'git push --tags'; it pushes only the named aliases.
    If a remote tag exists at a different commit, use
    'git push --force-with-lease origin <tag>' to recover.

Exit codes:
  0   help requested
  1   bad input, missing arguments, or unsafe state
  2   unknown subcommand
  127 required command ('git' or 'node') not found
USAGE
  exit "${1:-1}"
}

# Verify required external commands are on PATH.
require_deps() {
  local cmd
  for cmd in git node; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "$PROG: required command '$cmd' not found on PATH" >&2
      exit 127
    fi
  done
}

# Populate parallel arrays of workspace dirs and their new tag prefixes.
# Uses nameref parameters so callers receive the arrays by reference.
list_workspaces() {
  local -n out_dirs="$1"
  local -n out_prefixes="$2"

  local dir unscoped
  while IFS=$'\t' read -r dir unscoped; do
    [[ -z "$dir" ]] && continue
    out_dirs+=("$dir")
    out_prefixes+=("${unscoped}-v")
  done < <(node "$SCRIPT_DIR/list-workspaces.mjs")

  if [[ ${#out_dirs[@]} -eq 0 ]]; then
    echo "$PROG: no workspaces discovered (is pnpm-workspace.yaml present in CWD?)" >&2
    exit 1
  fi
}

# Check whether a value appears in the remaining arguments.
contains() {
  local needle="$1"
  shift
  local candidate
  for candidate in "$@"; do
    if [[ "$candidate" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

# Execute the 'apply' subcommand across all selected workspaces.
run_apply() {
  local dry_run="$1"
  local force="$2"
  local only="$3"
  local -n in_dirs="$4"
  local -n in_prefixes="$5"

  print_preview_header

  local total_to_alias=0
  local -a conflict_messages=()

  # Per-workspace state captured during preview so we can replay actions.
  local -a pending_workspaces=()
  local -a pending_old_tags=()

  local index
  for ((index = 0; index < ${#in_dirs[@]}; index++)); do
    local dir="${in_dirs[$index]}"
    local new_prefix="${in_prefixes[$index]}"
    local old_prefix="${dir}-v"

    if [[ -n "$only" && "$dir" != "$only" ]]; then
      continue
    fi

    if [[ "$old_prefix" == "$new_prefix" ]]; then
      print_preview_row "$new_prefix" "✅ consistent"
      continue
    fi

    local -a old_tags=()
    mapfile -t old_tags < <(list_old_tags "$old_prefix")

    if [[ ${#old_tags[@]} -eq 0 ]]; then
      print_preview_row "$new_prefix" "⚠️ no existing tags"
      continue
    fi

    local -a to_alias=()
    local -a conflicts=()
    classify_tags "$old_prefix" "$new_prefix" to_alias conflicts "${old_tags[@]}"

    # With --force, conflicts are converted into replacements and treated as
    # part of the work to apply. Without --force they remain conflicts.
    local -a pending_for_workspace=("${to_alias[@]}")
    if [[ "$force" == true && ${#conflicts[@]} -gt 0 ]]; then
      local conflict_new_tag
      for conflict_new_tag in "${conflicts[@]}"; do
        local conflict_suffix="${conflict_new_tag#"$new_prefix"}"
        pending_for_workspace+=("${old_prefix}${conflict_suffix}")
      done
    fi

    if [[ ${#conflicts[@]} -gt 0 && "$force" != true ]]; then
      print_preview_row "$new_prefix" "⛔ ${#conflicts[@]} tag conflict(s)"
      local conflict
      for conflict in "${conflicts[@]}"; do
        conflict_messages+=("⛔ tag conflict: $conflict exists at a different commit (use --force to replace)")
      done
    elif [[ ${#pending_for_workspace[@]} -gt 0 ]]; then
      if [[ "$dry_run" == true ]]; then
        print_preview_row "$new_prefix" "🏷️ ${#pending_for_workspace[@]} tags to alias"
      else
        print_preview_row "$new_prefix" "🏷️ ${#pending_for_workspace[@]} tags aliased"
      fi
    else
      print_preview_row "$new_prefix" "✅ consistent"
    fi

    if [[ ${#pending_for_workspace[@]} -gt 0 ]]; then
      total_to_alias=$((total_to_alias + ${#pending_for_workspace[@]}))
      # Store the old-tag list as a tab-joined string per workspace so we
      # can iterate over it after the preview loop.
      pending_workspaces+=("$dir"$'\t'"$new_prefix")
      pending_old_tags+=("$(IFS=$'\t'; echo "${pending_for_workspace[*]}")")
    fi

    if [[ ${#pending_for_workspace[@]} -gt 0 ]]; then
      print_tag_detail "Tags to alias" "$old_prefix" "$new_prefix" "${pending_for_workspace[@]}"
    fi
  done

  if [[ ${#conflict_messages[@]} -gt 0 && "$force" != true ]]; then
    echo ""
    local message
    for message in "${conflict_messages[@]}"; do
      echo "$message" >&2
    done
    echo "$PROG: aborting without creating aliases; re-run with --force to replace mismatched tags" >&2
    exit 1
  fi

  if [[ "$dry_run" == true ]]; then
    echo ""
    echo "Dry run — no tags were created. $total_to_alias tags would be aliased."
    return 0
  fi

  # Apply phase: create aliases for every pending workspace.
  local pending_index
  for ((pending_index = 0; pending_index < ${#pending_workspaces[@]}; pending_index++)); do
    local workspace_info="${pending_workspaces[$pending_index]}"
    local dir="${workspace_info%%$'\t'*}"
    local new_prefix="${workspace_info##*$'\t'}"
    local old_prefix="${dir}-v"

    local -a old_tags=()
    IFS=$'\t' read -r -a old_tags <<< "${pending_old_tags[$pending_index]}"

    local old_tag
    for old_tag in "${old_tags[@]}"; do
      [[ -z "$old_tag" ]] && continue
      local suffix="${old_tag#"$old_prefix"}"
      local new_tag="${new_prefix}${suffix}"

      if tag_exists_locally "$new_tag"; then
        if tags_point_at_same_commit "$old_tag" "$new_tag"; then
          continue
        fi
        # Only reached with --force; the preflight loop otherwise aborted.
        delete_alias "$new_tag"
      fi

      create_alias "$old_tag" "$new_tag"
    done
  done

  echo ""
  if [[ $total_to_alias -eq 0 ]]; then
    echo "Already applied. Run '$PROG push' when ready to publish."
  else
    echo "Applied. $total_to_alias aliases created. Run '$PROG push' when ready to publish."
  fi
}

# Execute the 'push' subcommand across all selected workspaces.
run_push() {
  local dry_run="$1"
  local only="$2"
  local -n in_dirs="$3"
  local -n in_prefixes="$4"

  print_preview_header

  local -a to_push=()
  local -a missing=()

  local index
  for ((index = 0; index < ${#in_dirs[@]}; index++)); do
    local dir="${in_dirs[$index]}"
    local new_prefix="${in_prefixes[$index]}"
    local old_prefix="${dir}-v"

    if [[ -n "$only" && "$dir" != "$only" ]]; then
      continue
    fi

    if [[ "$old_prefix" == "$new_prefix" ]]; then
      print_preview_row "$new_prefix" "✅ consistent"
      continue
    fi

    local -a old_tags=()
    mapfile -t old_tags < <(list_old_tags "$old_prefix")

    if [[ ${#old_tags[@]} -eq 0 ]]; then
      print_preview_row "$new_prefix" "⚠️ no existing tags"
      continue
    fi

    local -a workspace_to_push=()
    local -a workspace_pushable_old_tags=()
    local -a workspace_missing=()

    local old_tag
    for old_tag in "${old_tags[@]}"; do
      local suffix="${old_tag#"$old_prefix"}"
      local new_tag="${new_prefix}${suffix}"

      if tag_exists_locally "$new_tag"; then
        workspace_to_push+=("$new_tag")
        workspace_pushable_old_tags+=("$old_tag")
      else
        workspace_missing+=("$new_tag")
      fi
    done

    if [[ ${#workspace_missing[@]} -gt 0 ]]; then
      print_preview_row "$new_prefix" "⛔ ${#workspace_missing[@]} tags not applied locally"
    elif [[ ${#workspace_to_push[@]} -gt 0 ]]; then
      print_preview_row "$new_prefix" "🚀 ${#workspace_to_push[@]} tags to push"
    else
      print_preview_row "$new_prefix" "✅ consistent"
    fi

    if [[ ${#workspace_to_push[@]} -gt 0 ]]; then
      to_push+=("${workspace_to_push[@]}")
    fi
    if [[ ${#workspace_missing[@]} -gt 0 ]]; then
      missing+=("${workspace_missing[@]}")
    fi

    if [[ ${#workspace_pushable_old_tags[@]} -gt 0 ]]; then
      print_tag_detail "Tags to push" "$old_prefix" "$new_prefix" "${workspace_pushable_old_tags[@]}"
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo ""
    echo "⛔ ${#missing[@]} tags not applied locally:" >&2
    local missing_tag
    for missing_tag in "${missing[@]}"; do
      echo "  $missing_tag" >&2
    done
    echo "Run '$PROG apply' first." >&2
    exit 1
  fi

  if [[ ${#to_push[@]} -eq 0 ]]; then
    echo ""
    echo "Nothing to push."
    return 0
  fi

  if [[ "$dry_run" == true ]]; then
    echo ""
    echo "Dry run — would push ${#to_push[@]} tags to origin."
    return 0
  fi

  git push origin "${to_push[@]}"
  echo ""
  echo "Pushed ${#to_push[@]} tags to origin."
}

# Print the preview-table header.
print_preview_header() {
  printf '%-22s %s\n' "New prefix" "Status"
  printf '%-22s %s\n' "----------------------" "--------------------"
}

# Print a single preview-table row.
print_preview_row() {
  local new_prefix="$1"
  local status="$2"
  printf '%-22s %s\n' "$new_prefix" "$status"
}

# Print per-tag detail under the preview table.
print_tag_detail() {
  local label="$1"
  local old_prefix="$2"
  local new_prefix="$3"
  shift 3
  local tags=("$@")

  if [[ ${#tags[@]} -eq 0 ]]; then
    return 0
  fi

  echo ""
  echo "$label:"
  local old_tag
  for old_tag in "${tags[@]}"; do
    local suffix="${old_tag#"$old_prefix"}"
    local new_tag="${new_prefix}${suffix}"
    printf '  %s  →  %s\n' "$old_tag" "$new_tag"
  done
  echo ""
}

# List all tags matching the old prefix, newest first.
list_old_tags() {
  local old_prefix="$1"
  git tag --list "${old_prefix}*" --sort=-v:refname
}

# Partition old tags into aliases to create and conflicts.
classify_tags() {
  local old_prefix="$1"
  local new_prefix="$2"
  local -n out_to_alias="$3"
  local -n out_conflicts="$4"
  shift 4
  local old_tags=("$@")

  local old_tag
  for old_tag in "${old_tags[@]}"; do
    local suffix="${old_tag#"$old_prefix"}"
    local new_tag="${new_prefix}${suffix}"

    if tag_exists_locally "$new_tag"; then
      if tags_point_at_same_commit "$old_tag" "$new_tag"; then
        continue
      fi
      out_conflicts+=("$new_tag")
      continue
    fi
    out_to_alias+=("$old_tag")
  done
}

# Test whether a local tag with the given name exists.
tag_exists_locally() {
  local tag="$1"
  git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null
}

# Test whether two tags resolve to the same commit.
tags_point_at_same_commit() {
  local left="$1"
  local right="$2"
  local left_sha right_sha
  left_sha="$(git rev-parse --verify --quiet "${left}^{commit}" || true)"
  right_sha="$(git rev-parse --verify --quiet "${right}^{commit}" || true)"
  [[ -n "$left_sha" && "$left_sha" == "$right_sha" ]]
}

# Create an annotated-tag alias that preserves the original annotation.
create_alias() {
  local old_tag="$1"
  local new_tag="$2"
  local original_msg
  original_msg="$(git for-each-ref --format='%(contents)' "refs/tags/${old_tag}")"
  git tag --annotate "${new_tag}" \
    --message "${original_msg}"$'\n\nAlias for '"${old_tag}"'.' \
    "${old_tag}^{}"
}

# Delete a local tag (used only with --force on a conflicting alias).
delete_alias() {
  local tag="$1"
  git tag --delete "$tag" >/dev/null
}

# endregion | Helper functions

main "$@"
