#!/usr/bin/env node

const { APP_NAME, NAMESPACE, ARGOCD_NAMESPACE } = require("./config");
const { c, info, error } = require("./logger");
const { gitCommit, getLatestRevision, gitPush } = require("./git");
const { ocBuild, updateDeploymentImage } = require("./build");
const { argoLogin, waitForAutoSync } = require("./argocd");
const { cleanup } = require("./cleanup");

async function main() {
  console.log(`\n${c.bold}${c.cyan}  Deploy Script - ${APP_NAME}${c.reset}\n`);

  try {
    await cleanup(NAMESPACE);

    await gitCommit();
    const revision = await getLatestRevision();
    info(`Revision: ${c.cyan}${revision}${c.reset}`);

    await ocBuild(APP_NAME, NAMESPACE, revision);
    await updateDeploymentImage(APP_NAME, NAMESPACE, revision);

    await gitCommit(`deploy: update image tag to ${revision}`);
    const pushRevision = await gitPush();

    const token = await argoLogin(ARGOCD_NAMESPACE);
    await waitForAutoSync(token, pushRevision, APP_NAME, NAMESPACE);

    console.log(`\n${c.green}${c.bold}  Done!${c.reset}\n`);
  } catch (err) {
    console.log("");
    error(err.message);
    process.exit(1);
  }
}

main();
