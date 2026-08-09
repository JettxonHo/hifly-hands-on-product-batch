import { pathToFileURL } from "node:url";

import { createHiflyApiClient } from "../src/providers/hifly-api-client.js";

export async function checkHiflyApi({ env = process.env, fetchImpl = globalThis.fetch, write = console.log } = {}) {
  const client = createHiflyApiClient({
    token: env.HIFLY_API_TOKEN,
    timeoutMs: Number(env.HIFLY_API_TIMEOUT_MS || 10_000),
    fetchImpl
  });
  const credit = await client.getAccountCredit();
  const result = { provider: "hifly", status: "connected", account_credit: { left: credit.left } };
  write(JSON.stringify(result));
  return result;
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  try {
    await checkHiflyApi();
  } catch (error) {
    console.error(error?.code || "HIFLY_API_CHECK_FAILED");
    process.exitCode = 1;
  }
}
