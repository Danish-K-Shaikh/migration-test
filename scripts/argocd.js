const https = require("https");
const { info, success, error, warn, section, c } = require("./logger");
const { run, sleep } = require("./utils");
const { APP_NAME, NAMESPACE, ARGOCD_NAMESPACE, ARGOCD_SERVER, ARGOCD_USERNAME, ARGOCD_PASSWORD } = require("./config");

const tlsAgent = new https.Agent({ rejectUnauthorized: false });

function httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: ARGOCD_SERVER,
      port: 443,
      path,
      method,
      agent: tlsAgent,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(payload && { "Content-Length": Buffer.byteLength(payload) }),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function argoLogin() {
  const password =
    ARGOCD_PASSWORD ||
    (await run("oc", [
      "get", "secret", "openshift-gitops-cluster",
      "-n", ARGOCD_NAMESPACE,
      "-o", "jsonpath={.data.admin\\.password}",
    ]).then((b64) => Buffer.from(b64, "base64").toString()));

  const res = await httpRequest("POST", "/api/v1/session", { username: ARGOCD_USERNAME, password });
  if (res.status !== 200) throw new Error(`ArgoCD login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function argoGetApp(token) {
  const res = await httpRequest("GET", `/api/v1/applications/${APP_NAME}`, null, token);
  if (res.status !== 200) throw new Error(`Failed to get app: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function argoSync() {
  section("ArgoCD - Trigger Sync");

  info("Triggering ArgoCD sync...");
  await run("oc", [
    "patch", "application", APP_NAME,
    "-n", ARGOCD_NAMESPACE,
    "--type", "merge",
    "-p", JSON.stringify({
      operation: {
        initiatedBy: { username: "deploy-script" },
        sync: { revision: "HEAD", prune: true },
      },
    }),
  ]);

  success("Sync triggered.");
}

async function watchStatus() {
  section("ArgoCD - Deployment Status");

  info("Authenticating with ArgoCD API...");
  const token = await argoLogin();
  success(`Authenticated → https://${ARGOCD_SERVER}`);

  const MAX_WAIT = 5 * 60 * 1000;
  const INTERVAL = 5000;
  const start = Date.now();

  info("Polling ArgoCD API for sync and health status...\n");

  while (Date.now() - start < MAX_WAIT) {
    const app = await argoGetApp(token);
    const sync    = app.status?.sync?.status    || "Unknown";
    const health  = app.status?.health?.status  || "Unknown";
    const message = app.status?.operationState?.message || "";

    const syncColor   = sync   === "Synced"     ? c.green : c.yellow;
    const healthColor = health === "Healthy"     ? c.green
                      : health === "Progressing" ? c.yellow : c.red;

    process.stdout.write(
      `\r  Sync: ${syncColor}${c.bold}${sync.padEnd(10)}${c.reset}` +
      `  Health: ${healthColor}${c.bold}${health.padEnd(12)}${c.reset}` +
      `  ${c.gray}(${Math.round((Date.now() - start) / 1000)}s elapsed)${c.reset}  `,
    );

    if (sync === "Synced" && health === "Healthy") {
      console.log("\n");
      success("Application is Synced and Healthy!");
      break;
    }

    if (health === "Degraded") {
      console.log("\n");
      error("Application health is Degraded.");
      if (message) error(`Reason: ${message}`);
      break;
    }

    if (Date.now() - start >= MAX_WAIT) {
      console.log("\n");
      warn("Timed out waiting for healthy status.");
      break;
    }

    await sleep(INTERVAL);
  }

  console.log("");
  section("Pod Status");
  const pods = await run("oc", ["get", "pods", "-n", NAMESPACE, "-l", `app=${APP_NAME}`], {
    ignoreError: true,
  });
  console.log(pods || "No pods found.");
}

module.exports = { argoSync, watchStatus };
