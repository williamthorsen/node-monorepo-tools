#!/usr/bin/env bash

exitOnError() {
  if [ $? -ne 0 ]; then
    echo "Error: $1"
    exit 1
  fi
}

PROFILE=${1:-$PROFILE}

if [ -z "${PROFILE}" ]; then
  echo "Usage: $0 {profile}"
  exit 1
fi

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
exitOnError "Failed to get AWS account ID"

REGION=$(aws configure get region --profile "${PROFILE}")
exitOnError "Failed to get AWS region"

echo "Bootstrapping account ${ACCOUNT} in region ${REGION}"

pnpm cdk bootstrap "aws://${ACCOUNT}/${REGION}"
