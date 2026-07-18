import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import open from "open";
import { chromium } from "playwright";

import { loadConfig, resolveFromRoot } from "../config.js";
import { createHiflyExecutor } from "../executors/hifly-executor.js";
import { createYingdaoRpaExecutor } from "../executors/yingdao-rpa-executor.js";
import { createCaptureHttpExecutor } from "../executors/capture-http-executor.js";
import { HiflyHandsOnProductPage } from "../hifly-page.js";
import { BatchLogger } from "../logger.js";
import { getProjectRoot } from "../core/project-root.js";
import { createFetchLiveTransport } from "../rpa/capture/fetch-live-transport.js";
import { createPlaywrightRuntimeAuthProvider } from "../rpa/capture/playwright-runtime-auth.js";
import { buildApp } from "./app.js";

const DEFAULT_PORT = 4317;

function resolvedPath(root, value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function playwrightContextOptions(root, config, options = {}) {
  return {
    headless: config.browser.headless,
    slowMo: config.browser.slowMoMs,
    viewport: config.browser.viewport,
    acceptDownloads: true,
    args: ["--disable-session-crashed-bubble", "--no-default-browser-check"],
    ...(options.recordHarPath ? {
      recordHar: {
        path: resolvedPath(root, options.recordHarPath),
        content: "embed"
      }
    } : {})
  };
}

function createLazyHiflyExecutor(root, options = {}) {
  let context;
  let delegate;

  async function ensureDelegate() {
    if (delegate) return delegate;
    const config = loadConfig(path.join(root, "config.local.json"));
    const profileDir = resolvedPath(root, config.browser.profileDir);
    context = await chromium.launchPersistentContext(profileDir, playwrightContextOptions(root, config, options));
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.batch.defaultTimeoutMs);
    const logger = new BatchLogger(config);
    delegate = createHiflyExecutor({ hiflyPage: new HiflyHandsOnProductPage(page, config, logger) });
    return delegate;
  }

  return {
    async createAsset(...args) { return (await ensureDelegate()).createAsset(...args); },
    async submitVideo(...args) { return (await ensureDelegate()).submitVideo(...args); },
    async querySubmission(...args) { return (await ensureDelegate()).querySubmission(...args); },
    async downloadArtifact(...args) { return (await ensureDelegate()).downloadArtifact(...args); },
    async reconcileSubmission(...args) { return (await ensureDelegate()).reconcileSubmission(...args); },
    async close() { await context?.close(); },
    recordHarPath: options.recordHarPath ?? null
  };
}

export function createExecutorForBackend(root, config = {}, options = {}) {
  const backend = config.executionBackend || "playwright";
  if (backend === "playwright") {
    const executor = createLazyHiflyExecutor(root, options);
    return Object.assign(executor, { backend: "playwright" });
  }
  if (backend === "yingdao_rpa") {
    if (config.rpa?.mode === "capture_http") {
      const executor = createCaptureHttpExecutor({ root, config });
      return Object.assign(executor, { backend: "yingdao_rpa", mode: "capture_http" });
    }
    const executor = createYingdaoRpaExecutor({ root, config });
    return Object.assign(executor, { backend: "yingdao_rpa" });
  }
  throw new Error(`Unsupported executionBackend: ${backend}`);
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
  handleSignals = true,
  uploadLimits = null,
  executionLock = {},
  pointsEstimate = {},
  generationConfig = {}
} = {}) {
  let selectedPort = await findAvailablePort(port);
  let app;
  while (true) {
    executor.setCallbackBaseUrl?.(`http://127.0.0.1:${selectedPort}`);
    app = await buildApp({
      root,
      executor,
      openBrowser,
      allowedHost: `127.0.0.1:${selectedPort}`,
      uploadLimits,
      executionLock,
      pointsEstimate,
      generationConfig,
      captureLive: {
        authProvider: createPlaywrightRuntimeAuthProvider({
          chromium,
          profileDir: resolvedPath(root, generationConfig.browser?.profileDir || "playwright/profile/hifly"),
          allowedDomains: generationConfig.rpa?.realLive?.allowedDomains || [
            "hiflyworks-api.lingverse.co",
            "hifly.cc",
            "lingverse.co"
          ]
        }),
        transport: createFetchLiveTransport({
          maxBytes: generationConfig.rpa?.realLive?.maxArtifactBytes
        })
      },
      executorFactory: ({ recordHarPath }) => createExecutorForBackend(root, generationConfig, { recordHarPath })
    });
    try {
      await app.listen({ host: "127.0.0.1", port: selectedPort });
      break;
    } catch (error) {
      await app.close();
      if (error?.code !== "EADDRINUSE") throw error;
      selectedPort = await findAvailablePort(selectedPort + 1);
    }
  }
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

if (isDirectExecution()) {
  const root = getProjectRoot();
  const config = loadConfig(path.join(root, "config.local.json"));
  const executor = createExecutorForBackend(root, config);
  const openBrowser = config.gui?.openBrowser === false
    ? async (url) => console.log(`Open this URL in a browser: ${url}`)
    : open;
  await startServer({
    root,
    executor,
    port: process.env.HIFLY_GUI_PORT ?? config.gui?.port ?? DEFAULT_PORT,
    openBrowser,
    uploadLimits: config.uploadLimits,
    executionLock: config.executionLock,
    pointsEstimate: config.pointsEstimate,
    generationConfig: config
  });
}
