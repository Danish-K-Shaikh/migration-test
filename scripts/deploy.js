#!/usr/bin/env node

const { c, error } = require("./logger");
const { gitCommitAndPush } = require("./git");
const { ocBuild } = require("./build");
const { argoSync, watchStatus } = require("./argocd");

async function main() {
  console.log(
    `\n${c.bold}${c.cyan}  Deploy Script - migration-test${c.reset}\n`,
  );

  try {
    await ocBuild();
    await gitCommitAndPush();
    await argoSync();
    await watchStatus();
    console.log(`\n${c.green}${c.bold}  Done!${c.reset}\n`);
  } catch (err) {
    console.log("");
    error(err.message);
    process.exit(1);
  }
}

main();
