const { info, success, warn, section, c } = require("./logger");
const { run } = require("./utils");
const { NAMESPACE } = require("./config");

const BUILDS_TO_KEEP = 3;

// -- Evicted pods -------------------------------------------------------------

async function deleteEvictedPods() {
  info("Scanning for evicted pods across all namespaces...");

  const raw = await run("oc", [
    "get", "pods",
    "--all-namespaces",
    "--field-selector=status.phase=Failed",
    "-o", "json",
  ]);

  const pods = JSON.parse(raw).items.filter(
    (p) => p.status?.reason === "Evicted",
  );

  if (!pods.length) {
    warn("No evicted pods found.");
    return;
  }

  let deleted = 0;
  for (const pod of pods) {
    const ns   = pod.metadata.namespace;
    const name = pod.metadata.name;
    await run("oc", ["delete", "pod", name, "-n", ns], { ignoreError: true });
    console.log(`  ${c.gray}deleted pod ${name} (${ns})${c.reset}`);
    deleted++;
  }

  success(`Deleted ${deleted} evicted pod${deleted !== 1 ? "s" : ""}.`);
}

// -- Old builds ---------------------------------------------------------------

async function deleteOldBuilds() {
  info(`Scanning builds in namespace "${NAMESPACE}" (keeping latest ${BUILDS_TO_KEEP})...`);

  const raw = await run("oc", [
    "get", "builds",
    "-n", NAMESPACE,
    "-o", "json",
  ]);

  const allBuilds = JSON.parse(raw).items;
  if (!allBuilds.length) {
    warn("No builds found.");
    return;
  }

  // Group by BuildConfig
  const byConfig = {};
  for (const build of allBuilds) {
    const bc = build.metadata.labels?.["buildconfig"] || "unknown";
    (byConfig[bc] = byConfig[bc] || []).push(build);
  }

  let deleted = 0;
  for (const [bc, builds] of Object.entries(byConfig)) {
    // Sort oldest → newest
    const sorted = builds.sort(
      (a, b) => new Date(a.metadata.creationTimestamp) - new Date(b.metadata.creationTimestamp),
    );

    const toDelete = sorted.slice(0, Math.max(0, sorted.length - BUILDS_TO_KEEP));
    if (!toDelete.length) {
      info(`BuildConfig "${bc}": ${sorted.length} build(s) — nothing to prune.`);
      continue;
    }

    for (const build of toDelete) {
      const name   = build.metadata.name;
      const status = build.status?.phase || "Unknown";
      await run("oc", ["delete", "build", name, "-n", NAMESPACE], { ignoreError: true });
      console.log(`  ${c.gray}deleted build ${name} [${status}]${c.reset}`);
      deleted++;
    }

    info(`BuildConfig "${bc}": kept ${BUILDS_TO_KEEP}, deleted ${toDelete.length}.`);
  }

  success(`Deleted ${deleted} old build${deleted !== 1 ? "s" : ""}.`);
}

// -- Main cleanup entry -------------------------------------------------------

async function cleanup() {
  section("Cleanup - Evicted Pods & Old Builds");
  await deleteEvictedPods();
  console.log("");
  await deleteOldBuilds();
}

module.exports = { cleanup };
