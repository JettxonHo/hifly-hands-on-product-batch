import { createCloudPlaywrightAdapter } from "./playwright-adapter.js";

const failure = (code) => Object.assign(new Error(code), { code });

function assertLoginConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw failure("CLOUD_EXECUTOR_LOGIN_CONFIG_REQUIRED");
  if (config.enabled !== true || config.mode !== "login") throw failure("CLOUD_EXECUTOR_LOGIN_MODE_REQUIRED");
  if (config.configured !== true || !config.workspace?.root || !config.workspace?.profileDir) {
    throw failure("CLOUD_EXECUTOR_LOGIN_CONFIG_UNAVAILABLE");
  }
}

export function createCloudExecutorLoginRuntime({
  config,
  adapterFactory = createCloudPlaywrightAdapter,
  adapterOptions = {}
} = {}) {
  assertLoginConfig(config);
  if (typeof adapterFactory !== "function") throw new TypeError("cloud executor login adapter is required");

  const adapter = adapterFactory({
    ...adapterOptions,
    workspace: config.workspace,
    hiflyConfig: config.hiflyConfig || {},
    browserOptions: {
      headless: false,
      ...(config.browserOptions || {}),
      ...(adapterOptions.browserOptions || {})
    }
  });
  if (!adapter || typeof adapter.login !== "function") throw new TypeError("cloud executor login adapter must expose login");

  let closed = false;
  return {
    executorType: "cloud_executor",
    mode: "login",
    service: null,
    worker: null,
    async login({ waitForInput = async () => undefined } = {}) {
      if (closed) throw failure("CLOUD_EXECUTOR_LOGIN_CLOSED");
      try {
        const result = await adapter.login({ waitForInput });
        return { status: result?.status === "ready" ? "ready" : result?.status || "requires_login" };
      } catch (error) {
        if (error?.code === "LOGIN_REQUIRED") return { status: "requires_login" };
        throw error;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await adapter.close?.();
    }
  };
}
