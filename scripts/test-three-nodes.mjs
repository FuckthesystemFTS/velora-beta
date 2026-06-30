#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const repoRoot = resolve(process.cwd());
const nodeScript = join(repoRoot, "scripts", "velora-node.mjs");
const workspace = await mkdtemp(join(tmpdir(), "velora-three-nodes-"));
const reportPath = join(repoRoot, "tmp", "three-node-report.json");
const siteSource = join(repoRoot, "examples", "velora-demo-site");
const ports = { a: 4101, b: 4102, c: 4103 };
const nodes = [];
const report = {
  workspace,
  startedAt: new Date().toISOString(),
  nodeA: {},
  nodeB: {},
  nodeC: {},
  results: {}
};

try {
  const dataDirs = {
    a: join(workspace, "node-a"),
    b: join(workspace, "node-b"),
    c: join(workspace, "node-c")
  };
  const multiaddrA = `/ip4/127.0.0.1/tcp/${ports.a}/http`;

  nodes.push(spawnNode(dataDirs.a, ports.a));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  await waitForHealth(ports.a);
  nodes.push(spawnNode(dataDirs.b, ports.b, multiaddrA));
  nodes.push(spawnNode(dataDirs.c, ports.c, multiaddrA));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  await waitForHealth(ports.b);
  await waitForHealth(ports.c);
  report.results.nodesStarted = true;

  const publishV1 = await runNodeCommand(["publish", "--data-dir", dataDirs.a, "--listen-port", String(ports.a), "--site-path", siteSource]);
  report.results.publishV1 = publishV1;

  const searchB = await poll(async () => JSON.parse(await runNodeCommand(["search", "--data-dir", dataDirs.b, "--listen-port", String(ports.b), "--query", "demo"])), (value) => value.results?.some((entry) => entry.address === "shop.demo"), 12, 1000);
  report.results.searchOnNodeB = searchB;

  const fetchB = JSON.parse(await runNodeCommand(["fetch", "--data-dir", dataDirs.b, "--listen-port", String(ports.b), "--address", "shop.demo", "--bootstrap", multiaddrA]));
  report.results.fetchOnNodeB = fetchB;

  const siteCopyV11 = join(workspace, "velora-demo-site-v11");
  await copyDir(siteSource, siteCopyV11);
  await writeFile(join(siteCopyV11, "velora.json"), (await readFile(join(siteCopyV11, "velora.json"), "utf8")).replace('"version": "1.0.0"', '"version": "1.1.0"'), "utf8");
  await writeFile(join(siteCopyV11, "app.js"), `${await readFile(join(siteCopyV11, "app.js"), "utf8")}\nconsole.log('Velora 1.1.0');\n`, "utf8");
  const publishV11 = JSON.parse(await runNodeCommand(["publish", "--data-dir", dataDirs.a, "--listen-port", String(ports.a), "--site-path", siteCopyV11]));
  report.results.publishV11 = publishV11;

  const rollback = JSON.parse(await runNodeCommand(["rollback", "--data-dir", dataDirs.a, "--listen-port", String(ports.a), "--address", "shop.demo", "--version", "1.0.0"]));
  report.results.rollback = rollback;

  await stopNode(nodes.shift());
  report.results.nodeAStopped = true;

  const fetchC = JSON.parse(await runNodeCommand(["fetch", "--data-dir", dataDirs.c, "--listen-port", String(ports.c), "--address", "shop.demo", "--bootstrap", `/ip4/127.0.0.1/tcp/${ports.b}/http`]));
  report.results.fetchOnNodeCWhileAOffline = fetchC;
  report.results.cacheOffline = existsSync(fetchC.packagePath);

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.all(nodes.map((node) => stopNode(node).catch(() => undefined)));
}

function spawnNode(dataDir, port, bootstrap) {
  return spawn(process.execPath, ["--import", "tsx", nodeScript, "--data-dir", dataDir, "--listen-port", String(port), ...(bootstrap ? ["--bootstrap", bootstrap] : [])], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

async function stopNode(node) {
  if (!node || node.killed) {
    return;
  }
  node.kill();
  await new Promise((resolvePromise) => node.once("exit", resolvePromise));
}

async function waitForHealth(port) {
  await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    if (!response.ok) {
      throw new Error(`HEALTH_${port}`);
    }
    return response.json();
  }, (value) => value.ok === true, 120, 500);
}

async function poll(task, predicate, attempts, delayMs) {
  let lastValue;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastValue = await task();
      if (predicate(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      lastValue = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  }
  throw new Error(`POLL_FAILED ${JSON.stringify(lastValue)}`);
}

async function runNodeCommand(argv) {
  const child = spawn(process.execPath, ["--import", "tsx", nodeScript, ...argv], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolvePromise) => child.once("exit", resolvePromise));
  if (exitCode !== 0) {
    throw new Error(Buffer.concat(stderr).toString("utf8") || Buffer.concat(stdout).toString("utf8"));
  }
  return Buffer.concat(stdout).toString("utf8").trim();
}

async function copyDir(source, target) {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      continue;
    }
    await copyFile(sourcePath, targetPath);
  }
}
