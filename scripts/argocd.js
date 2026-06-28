const https = require("https");
const { info, success, error, warn, section, c } = require("./logger");
const { run, sleep } = require("./utils");
const { ARGOCD_SERVER, ARGOCD_USERNAME, ARGOCD_PASSWORD } = require("./config");

const tlsAgent = new https.Agent({ rejectUnauthorized: false });
const MAX_RESTARTS = 3;

// -- HTTP helpers --------------------------------------------------------------

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

function fetchPodLogs(token, appName, namespace, podName, container) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({
      podName,
      namespace,
      container: container || appName,
      tailLines: "50",
    });

    const options = {
      hostname: ARGOCD_SERVER,
      port: 443,
      path: `/api/v1/applications/${appName}/logs?${qs}`,
      method: "GET",
      agent: tlsAgent,
      headers: { Authorization: `Bearer ${token}` },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        const lines = raw
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try { return JSON.parse(line)?.result?.content || ""; }
            catch { return line; }
          })
          .filter(Boolean);
        resolve(lines);
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// -- ArgoCD API calls ---------------------------------------------------------

async function argoLogin(argocdNamespace) {
  const password =
    ARGOCD_PASSWORD ||
    (await run("oc", [
      "get", "secret", "openshift-gitops-cluster",
      "-n", argocdNamespace,
      "-o", "jsonpath={.data.admin\\.password}",
    ]).then((b64) => Buffer.from(b64, "base64").toString()));

  const res = await httpRequest("POST", "/api/v1/session", { username: ARGOCD_USERNAME, password });
  if (res.status !== 200) throw new Error(`ArgoCD login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function argoGetApp(token, appName) {
  const res = await httpRequest("GET", `/api/v1/applications/${appName}`, null, token);
  if (res.status !== 200) throw new Error(`Failed to get app: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function argoGetResourceTree(token, appName) {
  const res = await httpRequest("GET", `/api/v1/applications/${appName}/resource-tree`, null, token);
  if (res.status !== 200) throw new Error(`Failed to get resource tree: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function argoGetPodManifest(token, appName, namespace, podName) {
  const qs = new URLSearchParams({ namespace, resourceName: podName, version: "v1", kind: "Pod", group: "" });
  const res = await httpRequest("GET", `/api/v1/applications/${appName}/resource?${qs}`, null, token);
  if (res.status !== 200) return null;
  try { return JSON.parse(res.body.manifest); }
  catch { return null; }
}

// -- Pod helpers --------------------------------------------------------------

function printPodTable(nodes) {
  const pods = nodes.filter((n) => n.kind === "Pod");
  if (!pods.length) { warn("No pods found in ArgoCD resource tree."); return; }

  const healthColor = (h) =>
    h === "Healthy" ? c.green : h === "Progressing" ? c.yellow : h === "Degraded" ? c.red : c.gray;
  const col = (str, width) => String(str || "-").padEnd(width);

  console.log(`  ${c.bold}${col("NAME", 45)} ${col("RESTARTS", 10)} ${col("HEALTH", 14)} ${col("MESSAGE", 40)}${c.reset}`);
  console.log(`  ${"─".repeat(110)}`);

  for (const pod of pods) {
    const name    = pod.name || "-";
    const health  = pod.health?.status  || "Unknown";
    const message = pod.health?.message || "";
    const restarts = pod.info?.find((i) => i.name === "Restarts")?.value || "-";
    const hc      = healthColor(health);
    console.log(
      `  ${c.gray}${col(name, 45)}${c.reset}` +
      ` ${c.yellow}${col(restarts, 10)}${c.reset}` +
      ` ${hc}${c.bold}${col(health, 14)}${c.reset}` +
      ` ${c.gray}${message}${c.reset}`,
    );
  }
}

async function printPodLogs(token, appName, namespace, podName) {
  section(`Logs — ${podName}`);
  try {
    const lines = await fetchPodLogs(token, appName, namespace, podName, appName);
    if (!lines.length) { warn("No logs returned."); return; }
    lines.forEach((line) => console.log(`  ${c.gray}${line}${c.reset}`));
  } catch (err) {
    warn(`Could not fetch logs: ${err.message}`);
  }
}

async function findCrashingPods(token, appName, namespace, nodes) {
  const crashing = [];
  for (const node of nodes.filter((n) => n.kind === "Pod")) {
    const manifest = await argoGetPodManifest(token, appName, namespace, node.name);
    if (!manifest) continue;
    const totalRestarts = (manifest.status?.containerStatuses || [])
      .reduce((sum, cs) => sum + (cs.restartCount || 0), 0);
    if (totalRestarts > MAX_RESTARTS) crashing.push({ name: node.name, restarts: totalRestarts });
  }
  return crashing;
}

// -- Auto-sync watcher --------------------------------------------------------

async function waitForAutoSync(token, expectedRevision, appName, namespace) {
  section("ArgoCD - Waiting for Auto-Sync");

  const short = expectedRevision.slice(0, 7);
  info(`Watching for ArgoCD to pick up revision ${c.cyan}${short}${c.reset}...\n`);

  const MAX_WAIT = 10 * 60 * 1000;
  const INTERVAL = 5000;
  const start    = Date.now();
  let phase      = "detecting";
  let crashed    = false;

  while (Date.now() - start < MAX_WAIT) {
    const app            = await argoGetApp(token, appName);
    const syncedRevision = app.status?.sync?.revision    || "";
    const syncStatus     = app.status?.sync?.status      || "Unknown";
    const health         = app.status?.health?.status    || "Unknown";
    const opPhase        = app.status?.operationState?.phase   || "";
    const opMessage      = app.status?.operationState?.message || "";
    const elapsed        = Math.round((Date.now() - start) / 1000);
    const revMatches     = syncedRevision.startsWith(short) ||
                           expectedRevision.startsWith(syncedRevision.slice(0, 7));

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
      const syncColor   = syncStatus === "Synced"      ? c.green  : c.yellow;
      const healthColor = health     === "Healthy"     ? c.green
                        : health     === "Progressing" ? c.yellow : c.red;

      process.stdout.write(
        `\r  Sync: ${syncColor}${c.bold}${syncStatus.padEnd(10)}${c.reset}` +
        `  Health: ${healthColor}${c.bold}${health.padEnd(12)}${c.reset}` +
        `  Op: ${c.gray}${(opPhase || "-").padEnd(10)}${c.reset}` +
        `  ${c.gray}(${elapsed}s elapsed)${c.reset}  `,
      );

      try {
        const tree = await argoGetResourceTree(token, appName);
        const crashingPods = await findCrashingPods(token, appName, namespace, tree.nodes || []);
        if (crashingPods.length) {
          console.log("\n");
          for (const pod of crashingPods) {
            error(`Pod ${c.bold}${pod.name}${c.reset}${c.red} has restarted ${pod.restarts} times (limit: ${MAX_RESTARTS}).`);
            await printPodLogs(token, appName, namespace, pod.name);
          }
          crashed = true;
          break;
        }
      } catch { /* non-fatal */ }

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

  console.log("");
  section("Pod Status");
  try {
    const tree = await argoGetResourceTree(token, appName);
    printPodTable(tree.nodes || []);
  } catch (err) {
    warn(`Could not fetch pod status from ArgoCD: ${err.message}`);
  }

  if (crashed) process.exit(1);
}

module.exports = { argoLogin, waitForAutoSync };
