import serverlessExpress from "@vendia/serverless-express";
import { app, start } from "./app.js";

let serverlessExpressInstance;

async function setup(event, context) {
  // Run the async bootstrap (db, cache) once per lambda container cold start
  await start();
  serverlessExpressInstance = serverlessExpress({ app });
  return serverlessExpressInstance(event, context);
}

export const handler = (event, context) => {
  if (serverlessExpressInstance) {
    return serverlessExpressInstance(event, context);
  }
  return setup(event, context);
};
