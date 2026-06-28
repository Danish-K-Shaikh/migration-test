const { c, info, success, warn, section } = require("./logger");
const { run, ask } = require("./utils");

async function gitCommit(message) {
  section("Git - Commit");

  const status = await run("git", ["status", "--porcelain"]);
  if (!status) {
    warn("No changes to commit - skipping.");
    return;
  }

  console.log(`${c.gray}${status}${c.reset}\n`);

  const commitMsg = message || process.argv[2] || (await ask(`${c.cyan}Commit message: ${c.reset}`));
  if (!commitMsg) throw new Error("Commit message is required.");

  info("Staging all changes...");
  await run("git", ["add", "."]);

  info(`Committing: "${commitMsg}"`);
  await run("git", ["commit", "-m", commitMsg]);

  success("Committed (not pushed).");
}

async function getLatestRevision() {
  return run("git", ["rev-parse", "--short", "HEAD"]);
}

async function gitPush() {
  section("Git - Push");

  info("Pushing to remote...");
  await run("git", ["push"]);

  const revision = await getLatestRevision();
  success(`Pushed. HEAD revision: ${c.cyan}${revision}${c.reset}`);
  return revision;
}

module.exports = { gitCommit, getLatestRevision, gitPush };
