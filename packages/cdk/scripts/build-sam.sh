#!/usr/bin/env bash

# This script must be able to run in the GitHub Actions runner, which does not have `zsh` installed.

APP_NAME=$(node -p "require('./cdk.json').context.appName")
STACK_NAME="${APP_NAME}Stack"

# Throw an error if APP_NAME is empty
if [ -z "${APP_NAME}" ]; then
  echo "Error: Expected context.appName to be set in cdk.json" >&2
  exit 1
fi

pnpm sam build --template "./.cdk.out/${STACK_NAME}.template.json"
if [ $? -ne 0 ]; then
  echo "Error: Failed to build SAM template" >&2
  exit 1
fi
