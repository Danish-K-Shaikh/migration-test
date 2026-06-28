const { c, info, success, warn, section } = require("./logger");
const { run, ask } = require("./utils");

async function gitCommitAndPush() {
  section("Git - Commit & Push");

  const status = await run("git", ["status", "--porcelain"]);
  if (!status) {
    warn("No changes to commit - skipping git step.");
    return;
  }

  console.log(`${c.gray}${status}${c.reset}\n`);

  const commitMsg = process.argv[2] || (await ask(`${c.cyan}Commit message: ${c.reset}`));
  if (!commitMsg) throw new Error("Commit message is required.");

  info("Staging all changes...");
  await run("git", ["add", "."]);

  info(`Committing: "${commitMsg}"`);
  await run("git", ["commit", "-m", commitMsg]);

  info("Pushing to remote...");
  await run("git", ["push"]);

  success("Code pushed successfully.");
}

module.exports = { gitCommitAndPush };
