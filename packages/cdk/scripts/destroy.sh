#!/usr/bin/env bash

# This script destroys the API stack for the specified branch.

# region Arguments
STAGE_NAME=${1:=$BRANCH}
# endregion

# region Functions
showUsage() {
  echo "Usage: $0 {stageName=BRANCH}"
}
# endregion

# region Argument validation
if [ -z "${STAGE_NAME}" ]; then
  showUsage
  exit 1
fi
# endregion

cd "$(dirname "$0")" || exit 1
./execute.sh destroy "$STAGE_NAME"
