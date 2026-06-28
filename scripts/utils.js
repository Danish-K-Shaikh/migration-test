const { spawn } = require("child_process");
const readline = require("readline");
const { c } = require("./logger");
const { PROJECT_DIR } = require("./config");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "pipe", cwd: PROJECT_DIR, ...opts });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d) => {
      stdout += d;
      if (opts.stream) process.stdout.write(c.gray + d.toString() + c.reset);
    });
    proc.stderr?.on("data", (d) => {
      stderr += d;
      if (opts.stream) process.stderr.write(c.gray + d.toString() + c.reset);
    });

    proc.on("close", (code) => {
      if (code !== 0 && !opts.ignoreError) {
        reject(new Error(stderr.trim() || `Command failed with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { run, ask, sleep };
