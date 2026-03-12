import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export class AppStack extends cdk.Stack {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(scope: Construct, constructId: string, props?: cdk.StackProps) {
    super(scope, constructId, props);
    // Instantiate stack constructs here
  }
}
