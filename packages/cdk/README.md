# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## How to

To **build** the project, run unit tests, and **deploy** the stack:

```shell
# Syntax
pnpm run deploy {stageName} {awsProfileName?}

# Example
pnpm run deploy next skypilot
```

---

To **build** the stack without deploying:

```shell
pnpm run build:cdk {stageName}
```

The generated files are not used in the `deploy` script, because that script builds the stack before deploying it.

## Useful commands

- `pnpm run build:tsc` compile typescript to js
- `pnpm run watch` watch for changes and compile
- `pnpm test` perform the unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
