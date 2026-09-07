import { rm } from "node:fs/promises";

const CLOSE_TIMEOUT_MS = 5_000;

async function closeResource(resource, label) {
  if (!resource || typeof resource.close !== "function") return;
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => resource.close()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} close timed out`)), CLOSE_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerBrowserCleanup(t, { root, getApp, getBrowser } = {}) {
  if (!t || typeof t.after !== "function") throw new TypeError("test context is required");

  t.after(async () => {
    const errors = [];
    const browser = typeof getBrowser === "function" ? getBrowser() : null;
    const app = typeof getApp === "function" ? getApp() : null;

    try {
      await closeResource(browser, "browser");
    } catch (error) {
      errors.push(error);
    }

    try {
      await closeResource(app, "app");
    } catch (error) {
      errors.push(error);
    }

    try {
      if (typeof root === "string" && root.length > 0) {
        await rm(root, { recursive: true, force: true });
      }
    } catch (error) {
      errors.push(error);
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "browser test cleanup failed");
  });
}
