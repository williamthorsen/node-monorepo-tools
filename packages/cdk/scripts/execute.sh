#!/usr/bin/env bash

# This script deploys an API stack for the specified branch to AWS.
# The stack template must first be synthesized using `synth.sh`.

# region Constants
STACK_NAME="AppStack" # TODO: Read from environment or file
# endregion

# region Arguments
OPERATION=$1
STAGE_NAME=$2
# endregion

# region Functions
showUsage() {
  echo "Usage: $0 deploy|destroy {stageName}"
}
# endregion

# region Argument validation
if [ -z "${OPERATION}" ] || [ -z "${STAGE_NAME}" ]; then
  showUsage
  exit 1
fi
# endregion

STAGE_NAME=$STAGE_NAME pnpm cdk "${OPERATION}" "${STACK_NAME}"
