import net from "node:net";
import path from "node:path";

import { createControlledCopyProvider } from "../copy-generation/controlled-provider.js";
import { createControlledQualityEvaluator } from "../copy-quality/controlled-evaluator.js";
import { createControlledCopyRewriter } from "../copy-quality/controlled-rewriter.js";
import { createFakeExecutor } from "../executors/fake-executor.js";
import { createControlledPreflightEvaluator } from "../video-planning/controlled-preflight-evaluator.js";
import { createDisabledLiveTransport } from "../rpa/capture/real-live-http-client.js";
import { createDemoConfig } from "./demo-config.js";

function localPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid demo GUI port");
  return port;
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
    if (error?.code === "EADDRINUSE") return false;
    throw error;
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

export async function findDemoPort(startPort = 4317) {
  const first = localPort(startPort);
  for (let port = first; port <= 65535; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("No local TCP port is available for the demo");
}

export function createDemoExecutor(scenario = {}) {
  return createFakeExecutor(scenario);
}

export function createDemoCaptureLive() {
  return {
    authProvider: {
      async getRuntimeAuth() {
        throw Object.assign(new Error("Real capture is disabled in the local demo"), {
          code: "DEMO_REAL_CAPTURE_DISABLED"
        });
      }
    },
    transport: createDisabledLiveTransport()
  };
}

export function demoLoginUrl(baseUrl, landingPath = "/login.html") {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw Object.assign(new Error("DEMO_LOGIN_URL_MUST_BE_LOOPBACK"), { code: "DEMO_LOGIN_URL_MUST_BE_LOOPBACK" });
  }
  if (typeof landingPath !== "string" || !landingPath.startsWith("/")) {
    throw new TypeError("demo landingPath must be absolute");
  }
  parsed.pathname = landingPath;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function createDemoAppOptions(config, executor, openBrowser) {
  return {
    root: config.root,
    executor,
    openBrowser,
    uploadLimits: config.generationConfig.uploadLimits,
    executionLock: config.generationConfig.executionLock,
    pointsEstimate: config.generationConfig.pointsEstimate,
    generationConfig: config.generationConfig,
    captureLive: createDemoCaptureLive(),
    identity: config.identity,
    assets: config.assets,
    projectContent: config.projectContent,
    operatorWorkspace: config.operatorWorkspace,
    copyGeneration: {
      ...config.copyGeneration,
      provider: createControlledCopyProvider()
    },
    copyQuality: {
      ...config.copyQuality,
      evaluator: createControlledQualityEvaluator(),
      rewriter: createControlledCopyRewriter()
    },
    copyReview: config.copyReview,
    avatarSelection: config.avatarSelection,
    videoPlanning: {
      ...config.videoPlanning,
      evaluator: createControlledPreflightEvaluator(),
      agentReadinessPort: { async isOnline() { return false; } }
    },
    productionOrders: config.productionOrders,
    manualHandoff: config.manualHandoff,
    manualExecution: config.manualExecution,
    artifactVerification: config.artifactVerification,
    workDelivery: config.workDelivery
  };
}

export async function startDemoServer({
  root,
  databaseUrl,
  port = 4317,
  openBrowser = async () => {},
  handleSignals = true
} = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("demo root is required");
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) throw new TypeError("demo databaseUrl is required");

  const { buildApp } = await import("./app.js");
  let selectedPort = await findDemoPort(port);
  let app;
  let config;
  let executor;
  while (true) {
    config = createDemoConfig({ root: path.resolve(root), port: selectedPort, databaseUrl });
    executor = createDemoExecutor();
    try {
      app = await buildApp(createDemoAppOptions(config, executor, openBrowser));
      await app.listen({ host: "127.0.0.1", port: selectedPort });
      break;
    } catch (error) {
      await app?.close().catch(() => undefined);
      if (error?.code !== "EADDRINUSE") throw error;
      selectedPort = await findDemoPort(selectedPort + 1);
    }
  }

  const baseUrl = `http://127.0.0.1:${selectedPort}`;
  const loginUrl = demoLoginUrl(baseUrl, config.landingPath);
  console.log(`Local VSA demo: ${baseUrl}`);
  console.log(`Demo login: ${config.credentials.email} / ${config.credentials.temporaryPassword}`);
  console.log("This is a fixed local test credential. Change it on first login; it is not a production password.");
  try {
    await openBrowser(loginUrl);
  } catch {
    console.log(`Open this URL in a browser: ${loginUrl}`);
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
  return { app, config, executor, url: baseUrl, loginUrl, port: selectedPort, close };
}
