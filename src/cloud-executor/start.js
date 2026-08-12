import { createCloudExecutorRuntime } from "./runtime.js";

export async function startCloudExecutorRuntime(options) {
  const runtime = createCloudExecutorRuntime(options);
  const startup = await runtime.start();
  return { runtime, startup };
}
