import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCloudExecutorConfig } from "../src/cloud-executor/config.js";
import { createCloudExecutorLoginRuntime } from "../src/cloud-executor/login.js";
import { loadConfig } from "../src/config.js";

function commandFrom(argv) {
  return argv.find((value) => !value.startsWith("-")) || "";
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "CLOUD_EXECUTOR_LOGIN_FAILED";
}

export async function waitForCloudExecutorLogin({ input = process.stdin, output = console } = {}) {
  output.log("Cloud Executor login mode is active. Complete provider login in the private browser session, then press Enter.");
  await once(input, "data");
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  root = process.cwd(),
  logger = console,
  configFactory = createCloudExecutorConfig,
  loadHiflyConfig = loadConfig,
  runtimeFactory = createCloudExecutorLoginRuntime,
  waitForInput = () => waitForCloudExecutorLogin({ input: process.stdin, output: logger })
} = {}) {
  if (commandFrom(argv) !== "login") {
    logger.error?.("CLOUD_EXECUTOR_LOGIN_COMMAND_REQUIRED");
    return { status: "failed", exitCode: 2 };
  }

  let config;
  try {
    config = configFactory({ root, env });
  } catch (error) {
    logger.error?.("cloud_executor_login_failed", { code: safeErrorCode(error) });
    return { status: "failed", exitCode: 1 };
  }
  if (config.enabled !== true) return { status: "disabled", exitCode: 1 };
  if (config.mode !== "login") return { status: "fail_closed", exitCode: 1 };
  if (config.configured !== true) return { status: "unconfigured", exitCode: 1 };

  let hiflyConfig;
  try {
    hiflyConfig = loadHiflyConfig(config.hiflyConfigPath);
  } catch (error) {
    logger.error?.("cloud_executor_login_failed", { code: safeErrorCode(error) });
    return { status: "failed", exitCode: 1 };
  }

  let runtime;
  try {
    runtime = runtimeFactory({ config: { ...config, hiflyConfig } });
    const result = await runtime.login({ waitForInput });
    return { status: result?.status || "requires_login", exitCode: result?.status === "ready" ? 0 : 1 };
  } catch (error) {
    logger.error?.("cloud_executor_login_failed", { code: safeErrorCode(error) });
    return { status: error?.code === "LOGIN_REQUIRED" ? "requires_login" : "failed", exitCode: 1 };
  } finally {
    try {
      await runtime?.close?.();
    } catch {
      // Closing the login browser must not expose session details or replace the controlled result.
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await main();
  process.exitCode = result.exitCode;
}
