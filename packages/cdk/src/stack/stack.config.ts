import type * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';

export const nodejsBundlingOptions: lambdaNodejs.BundlingOptions = {
  externalModules: ['@aws-sdk/*'],
  target: 'es2022',
};
