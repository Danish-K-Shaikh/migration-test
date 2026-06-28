const { info, success, section } = require("./logger");
const { run } = require("./utils");
const { APP_NAME, NAMESPACE, PROJECT_DIR } = require("./config");

async function ocBuild() {
  section("OpenShift - Build & Push Image");

  info(`Starting build for ${APP_NAME}...`);
  await run("oc", ["start-build", APP_NAME, `--from-dir=${PROJECT_DIR}`, "--follow", "-n", NAMESPACE], {
    stream: true,
  });

  success("Image built and pushed to internal registry.");
}

module.exports = { ocBuild };
