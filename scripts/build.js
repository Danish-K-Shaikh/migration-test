const fs = require("fs");
const path = require("path");
const { info, success, section } = require("./logger");
const { run } = require("./utils");
const { PROJECT_DIR } = require("./config");

const DEPLOYMENT_YAML = path.join(PROJECT_DIR, "argocd", "deployment.yaml");

async function ocBuild(appName, namespace, revision) {
  section("OpenShift - Build & Push Image");

  info(`Starting build for ${appName}...`);
  await run("oc", ["start-build", appName, `--from-dir=${PROJECT_DIR}`, "--follow", "-n", namespace], {
    stream: true,
  });

  info(`Tagging image as ${appName}:${revision}...`);
  await run("oc", ["tag", `${appName}:latest`, `${appName}:${revision}`, "-n", namespace]);

  success(`Image built and tagged as ${appName}:${revision}.`);
}

async function updateDeploymentImage(appName, namespace, revision) {
  section("Manifest - Update Image Tag");

  const imageTag = `image-registry.openshift-image-registry.svc:5000/${namespace}/${appName}:${revision}`;
  info(`Updating deployment image to: ${imageTag}`);

  const content = fs.readFileSync(DEPLOYMENT_YAML, "utf8");
  const updated = content.replace(/^(\s*image:\s*).*$/m, `$1${imageTag}`);

  if (content === updated) throw new Error("Image line not found in deployment.yaml — nothing updated.");

  fs.writeFileSync(DEPLOYMENT_YAML, updated, "utf8");
  success(`deployment.yaml updated with image tag ${revision}.`);
}

module.exports = { ocBuild, updateDeploymentImage };
