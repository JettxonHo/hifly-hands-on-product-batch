import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import open from "open";
import { chromium } from "playwright";

import { loadConfig, resolveFromRoot } from "../config.js";
import { createHiflyExecutor } from "../executors/hifly-executor.js";
import { HiflyHandsOnProductPage } from "../hifly-page.js";
import { getProjectRoot } from "../core/project-root.js";
import { buildApp } from "./app.js";

const DEFAULT_PORT = 4317;

function resolvedPath(root, value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function createLazyHiflyExecutor(root) {
  let context;
  let delegate;

  async function ensureDelegate() {
    if (delegate) return delegate;
    const config = loadConfig(path.join(root, "config.local.json"));
    const profileDir = resolvedPath(root, config.browser.profileDir);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: config.browser.headless,
      slowMo: config.browser.slowMoMs,
      viewport: config.browser.viewport,
      acceptDownloads: true
    });
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.batch.defaultTimeoutMs);
    const logger = { info() {}, error() {} };
    delegate = createHiflyExecutor({ hiflyPage: new HiflyHandsOnProductPage(page, config, logger) });
    return delegate;
  }

  return {
    async createAsset(...args) { return (await ensureDelegate()).createAsset(...args); },
    async submitVideo(...args) { return (await ensureDelegate()).submitVideo(...args); },
    async querySubmission(...args) { return (await ensureDelegate()).querySubmission(...args); },
    async downloadArtifact(...args) { return (await ensureDelegate()).downloadArtifact(...args); },
    async reconcileSubmission(...args) { return (await ensureDelegate()).reconcileSubmission(...args); },
    async close() { await context?.close(); }
  };
}

async function isPortAvailable(port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port }, resolve);
    });
    return true;
  } catch (error) {
    if (error.code === "EADDRINUSE") return false;
    throw error;
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

export async function findAvailablePort(startPort = DEFAULT_PORT) {
  const port = Number(startPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid GUI port");
  for (let candidate = port; candidate <= 65535; candidate += 1) {
    if (await isPortAvailable(candidate)) return candidate;
  }
  throw new Error("No local TCP port is available");
}

export async function startServer({
  root = getProjectRoot(),
  port = process.env.HIFLY_GUI_PORT ?? DEFAULT_PORT,
  executor = createLazyHiflyExecutor(root),
  openBrowser = open,
  handleSignals = true
} = {}) {
  const selectedPort = await findAvailablePort(port);
  const app = await buildApp({ root, executor, openBrowser, allowedHost: `127.0.0.1:${selectedPort}` });
  await app.listen({ host: "127.0.0.1", port: selectedPort });
  const url = `http://127.0.0.1:${selectedPort}`;
  console.log(`Local workbench: ${url}`);
  try {
    await openBrowser(url);
  } catch {
    console.log(`Open this URL in a browser: ${url}`);
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    await app.stopExecutions();
    await app.close();
    await executor.close?.();
  }
  async function shutdown() {
    await close();
  }
  if (handleSignals) {
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
  return { app, url, port: selectedPort, close };
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) await startServer();
