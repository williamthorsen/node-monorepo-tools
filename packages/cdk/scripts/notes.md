# AWS SDK notes

---

`build:cdk`

Creates a CloudFormation template in `.cdk.out/` from the instructions in `cdk.json` -- in particular, the entrypoint:

```json
{
  "app": "tsx src/bin/AppStack.cdk.ts"
}
```

---

`build:cdk:sam`

Creates a SAM template in `.aws-sam/` from the template in `cdk.out/`.
