import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getProjectRoot } from "../src/core/project-root.js";
import { loadConfig } from "../src/config.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { findAvailablePort, startServer } from "../src/server/start.js";
import { packageArtifacts } from "../scripts/package-artifacts.mjs";

test("local workbench starts from a non-project cwd", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-startup-root-"));
  const temporaryCwd = await mkdtemp(path.join(os.tmpdir(), "hifly-startup-cwd-"));
  const originalCwd = process.cwd();
  let server;
  t.after(async () => {
    process.chdir(originalCwd);
    await server?.close();
    await rm(root, { recursive: true, force: true });
    await rm(temporaryCwd, { recursive: true, force: true });
  });

  process.chdir(temporaryCwd);
  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      port: 4317,
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(getProjectRoot().endsWith("Product Recommendation clip"), true);
});

test("config fallback resolves next to an absolute missing local config", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-config-root-"));
  const temporaryCwd = await mkdtemp(path.join(os.tmpdir(), "hifly-config-cwd-"));
  const originalCwd = process.cwd();
  t.after(async () => {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
    await rm(temporaryCwd, { recursive: true, force: true });
  });
  await copyFile(path.join(getProjectRoot(), "config.example.json"), path.join(root, "config.example.json"));

  process.chdir(temporaryCwd);
  const config = loadConfig(path.join(root, "config.local.json"));

  assert.equal(config.__configPath, path.join(root, "config.example.json"));
  assert.equal(config.__rootDir, root);
});

test("default port collision advances to the next available port", async (t) => {
  let occupied;
  try {
    occupied = await listenOnLoopback(0);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }
  t.after(async () => {
    await closeServer(occupied);
  });

  const startPort = occupied.address().port;
  const selectedPort = await findAvailablePort(startPort);
  assert.equal(selectedPort, startPort + 1);
});

test("server passes the actual fallback port to the RPA executor", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-rpa-port-"));
  const occupied = await listenOnLoopback(0);
  const startPort = occupied.address().port;
  const callbackBaseUrls = [];
  const executor = createFakeExecutor();
  executor.setCallbackBaseUrl = (value) => callbackBaseUrls.push(value);
  let server;
  t.after(async () => {
    await server?.close();
    await closeServer(occupied);
    await rm(root, { recursive: true, force: true });
  });

  server = await startServer({
    root,
    executor,
    port: startPort,
    openBrowser: async () => {},
    handleSignals: false
  });

  assert.equal(server.port, startPort + 1);
  assert.equal(callbackBaseUrls.at(-1), `http://127.0.0.1:${server.port}`);
});

test("concurrent workbench starts from the same port choose distinct ports", async (t) => {
  const rootA = await mkdtemp(path.join(os.tmpdir(), "hifly-startup-a-"));
  const rootB = await mkdtemp(path.join(os.tmpdir(), "hifly-startup-b-"));
  const startPort = await findAvailablePort(4317);
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map((server) => server.close()));
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  });

  try {
    const started = await Promise.all([
      startServer({
        root: rootA,
        executor: createFakeExecutor(),
        port: startPort,
        openBrowser: async () => {},
        handleSignals: false
      }),
      startServer({
        root: rootB,
        executor: createFakeExecutor(),
        port: startPort,
        openBrowser: async () => {},
        handleSignals: false
      })
    ]);
    servers.push(...started);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  assert.equal(new Set(servers.map((server) => server.port)).size, 2);
  assert.ok(servers.every((server) => server.url === `http://127.0.0.1:${server.port}`));
});

test("delivery package includes GUI assets and excludes local state", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-package-"));
  t.after(async () => {
    await rm(outputRoot, { recursive: true, force: true });
  });

  const result = await packageArtifacts({
    root: getProjectRoot(),
    outputDir: path.join(outputRoot, "package"),
    archivePath: path.join(outputRoot, "hifly-package.tar.gz")
  });
  const files = await walk(result.outputDir);

  assert.ok(files.includes("web/index.html"));
  assert.ok(files.includes("web/app.js"));
  assert.ok(files.includes("web/api.js"));
  assert.ok(files.includes("src/server/start.js"));
  assert.ok(files.includes("src/server/app.js"));
  assert.ok(files.includes("docs/ENVIRONMENT.md"));
  assert.ok(files.includes("docs/新人培训使用手册.html"));

  for (const forbidden of [
    "workspace/",
    "batches/",
    "config.local.json",
    "playwright/.auth/",
    "playwright/profile/",
    "downloads/",
    "logs/",
    "outputs/",
    "screenshots/"
  ]) {
    assert.equal(files.some((file) => file === forbidden.slice(0, -1) || file.startsWith(forbidden)), false, forbidden);
  }
});

async function listenOnLoopback(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, resolve);
  });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function walk(root, prefix = "") {
  const names = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of names) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(`${relativePath}/`);
      files.push(...await walk(root, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files.sort();
}
