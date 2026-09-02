const serverlessExpress = require('@vendia/serverless-express');
const app = require('./server');

// Wrap the Express app for AWS Lambda
exports.handler = serverlessExpress({ app });
