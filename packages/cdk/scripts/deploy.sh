#!/usr/bin/env bash

# This script deploys an API stack for the specified branch to AWS.

# region Arguments
BRANCH_NAME=$1
# endregion

# region Functions
showUsage() {
  echo "Usage: $0 {branchName}"
}
# endregion

# region Argument validation
if [ -z "${BRANCH_NAME}" ]; then
  showUsage
  exit 1
fi
# endregion

cd "$(dirname "$0")" || exit 1
./execute.sh deploy "$BRANCH_NAME"
