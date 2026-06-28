const https = require("https");
const { info, success, error, warn, section, c } = require("./logger");
const { run, sleep } = require("./utils");
const {
  APP_NAME,
  NAMESPACE,
  ARGOCD_NAMESPACE,
  ARGOCD_SERVER,
  ARGOCD_USERNAME,
  ARGOCD_PASSWORD,
} = require("./config");

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

  const res = await httpRequest("POST", "/api/v1/session", {
    username: ARGOCD_USERNAME,
    password,
  });
  if (res.status !== 200) throw new Error(`ArgoCD login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function argoGetApp(token) {
  const res = await httpRequest("GET", `/api/v1/applications/${APP_NAME}`, null, token);
  if (res.status !== 200) throw new Error(`Failed to get app: ${JSON.stringify(res.body)}`);
  return res.body;
}

// -- Wait for ArgoCD to auto-detect the new revision and finish syncing --------

async function waitForAutoSync(token, expectedRevision) {
  section("ArgoCD - Waiting for Auto-Sync");

  const short = expectedRevision.slice(0, 7);
  info(`Watching for ArgoCD to pick up revision ${c.cyan}${short}${c.reset}...\n`);

  const MAX_WAIT = 10 * 60 * 1000; // ArgoCD polls git every ~3 min by default
  const INTERVAL = 5000;
  const start = Date.now();
  let phase = "detecting"; // detecting → syncing → healthy

  while (Date.now() - start < MAX_WAIT) {
    const app = await argoGetApp(token);
    const syncedRevision = app.status?.sync?.revision || "";
    const syncStatus     = app.status?.sync?.status   || "Unknown";
    const health         = app.status?.health?.status  || "Unknown";
    const opPhase        = app.status?.operationState?.phase || "";
    const opMessage      = app.status?.operationState?.message || "";
    const elapsed        = Math.round((Date.now() - start) / 1000);
    const revMatches     = syncedRevision.startsWith(short) || expectedRevision.startsWith(syncedRevision.slice(0, 7));

    if (phase === "detecting") {
      const countdown = Math.max(0, 180 - elapsed);
      process.stdout.write(
        `\r  ${c.yellow}${c.bold}Waiting for ArgoCD to detect changes...${c.reset}` +
        `  ${c.gray}revision: ${short}  elapsed: ${elapsed}s  (next poll ~${countdown}s)${c.reset}  `,
      );

      if (revMatches && opPhase === "Running") {
        console.log("\n");
        success(`ArgoCD detected revision ${short} — sync started.`);
        phase = "syncing";
      } else if (revMatches && syncStatus === "Synced") {
        console.log("\n");
        success(`ArgoCD already synced to revision ${short}.`);
        phase = "syncing";
      }
    } else if (phase === "syncing") {
      const syncColor   = syncStatus === "Synced"      ? c.green : c.yellow;
      const healthColor = health     === "Healthy"     ? c.green
                        : health     === "Progressing" ? c.yellow : c.red;

      process.stdout.write(
        `\r  Sync: ${syncColor}${c.bold}${syncStatus.padEnd(10)}${c.reset}` +
        `  Health: ${healthColor}${c.bold}${health.padEnd(12)}${c.reset}` +
        `  Op: ${c.gray}${(opPhase || "-").padEnd(10)}${c.reset}` +
        `  ${c.gray}(${elapsed}s elapsed)${c.reset}  `,
      );

      if (syncStatus === "Synced" && health === "Healthy") {
        console.log("\n");
        success("Deployment complete — Synced and Healthy!");
        break;
      }

      if (health === "Degraded") {
        console.log("\n");
        error("Deployment degraded.");
        if (opMessage) error(`Reason: ${opMessage}`);
        break;
      }

      if (opPhase === "Failed") {
        console.log("\n");
        error(`Sync failed: ${opMessage}`);
        break;
      }
    }

    if (Date.now() - start >= MAX_WAIT) {
      console.log("\n");
      warn("Timed out waiting for auto-sync. Check ArgoCD UI for details.");
      break;
    }

    await sleep(INTERVAL);
  }

  // Final pod status
  console.log("");
  section("Pod Status");
  const pods = await run(
    "oc",
    ["get", "pods", "-n", NAMESPACE, "-l", `app=${APP_NAME}`],
    { ignoreError: true },
  );
  console.log(pods || "No pods found.");
}

module.exports = { argoLogin, waitForAutoSync };
