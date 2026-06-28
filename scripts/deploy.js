#!/usr/bin/env node

const { c, error } = require("./logger");
const { gitCommitAndPush } = require("./git");
const { ocBuild } = require("./build");
const { argoLogin, waitForAutoSync } = require("./argocd");
const { cleanup } = require("./cleanup");

async function main() {
  console.log(`\n${c.bold}${c.cyan}  Deploy Script - migration-test${c.reset}\n`);

  try {
    await cleanup();
    await ocBuild();
    const revision = await gitCommitAndPush();
    const token = await argoLogin();
    await waitForAutoSync(token, revision);
    console.log(`\n${c.green}${c.bold}  Done!${c.reset}\n`);
  } catch (err) {
    console.log("");
    error(err.message);
    process.exit(1);
  }
}

main();
