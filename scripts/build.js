const fs = require("fs");
const path = require("path");
const { info, success, section } = require("./logger");
const { run } = require("./utils");
const { APP_NAME, NAMESPACE, PROJECT_DIR } = require("./config");

const DEPLOYMENT_YAML = path.join(PROJECT_DIR, "argocd", "deployment.yaml");
const IMAGE_BASE = `image-registry.openshift-image-registry.svc:5000/${NAMESPACE}/${APP_NAME}`;

async function ocBuild(revision) {
  section("OpenShift - Build & Push Image");

  info(`Starting build for ${APP_NAME}...`);
  await run(
    "oc",
    ["start-build", APP_NAME, `--from-dir=${PROJECT_DIR}`, "--follow", "-n", NAMESPACE],
    { stream: true },
  );

  info(`Tagging image as ${APP_NAME}:${revision}...`);
  await run("oc", [
    "tag",
    `${APP_NAME}:latest`,
    `${APP_NAME}:${revision}`,
    "-n", NAMESPACE,
  ]);

  success(`Image built and tagged as ${APP_NAME}:${revision}.`);
}

async function updateDeploymentImage(revision) {
  section("Manifest - Update Image Tag");

  const imageTag = `${IMAGE_BASE}:${revision}`;
  info(`Updating deployment image to: ${imageTag}`);

  const content = fs.readFileSync(DEPLOYMENT_YAML, "utf8");
  const updated = content.replace(
    /^(\s*image:\s*).*$/m,
    `$1${imageTag}`,
  );

  if (content === updated) throw new Error("Image line not found in deployment.yaml — nothing updated.");

  fs.writeFileSync(DEPLOYMENT_YAML, updated, "utf8");
  success(`deployment.yaml updated with image tag ${revision}.`);
}

module.exports = { ocBuild, updateDeploymentImage };
