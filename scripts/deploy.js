#!/usr/bin/env node

const { c, info, error } = require("./logger");
const { gitCommit, getLatestRevision, gitPush } = require("./git");
const { ocBuild, updateDeploymentImage } = require("./build");
const { argoLogin, waitForAutoSync } = require("./argocd");
const { cleanup } = require("./cleanup");

async function main() {
  console.log(`\n${c.bold}${c.cyan}  Deploy Script - migration-test${c.reset}\n`);

  try {
    // 1. Clean evicted pods and old builds
    await cleanup();

    // 2. Commit current changes (no push)
    await gitCommit();

    // 3. Get the revision of that commit
    const revision = await getLatestRevision();
    info(`Revision: ${c.cyan}${revision}${c.reset}`);

    // 4. Build image and tag it with the revision
    await ocBuild(revision);

    // 5. Update deployment.yaml with the new image tag
    await updateDeploymentImage(revision);

    // 6. Commit the manifest update and push everything
    await gitCommit(`deploy: update image tag to ${revision}`);
    const pushRevision = await gitPush();

    // 7. Login to ArgoCD and wait for auto-sync
    const token = await argoLogin();
    await waitForAutoSync(token, pushRevision);

    console.log(`\n${c.green}${c.bold}  Done!${c.reset}\n`);
  } catch (err) {
    console.log("");
    error(err.message);
    process.exit(1);
  }
}

main();
