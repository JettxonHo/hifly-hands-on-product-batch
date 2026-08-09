import assert from "node:assert/strict";
import test from "node:test";

import { checkHiflyApi } from "../scripts/check-hifly-api.mjs";

test("Hifly API check command prints a safe credit summary", async () => {
  const output = [];
  const result = await checkHiflyApi({
    env: { HIFLY_API_TOKEN: "private-test-token", HIFLY_API_TIMEOUT_MS: "5000" },
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer private-test-token");
      return new Response(JSON.stringify({ code: 0, left: 88, request_id: "req-cli" }), { status: 200 });
    },
    write: (value) => output.push(value)
  });

  assert.deepEqual(result, { provider: "hifly", status: "connected", account_credit: { left: 88 } });
  assert.deepEqual(output, [JSON.stringify(result)]);
  assert.doesNotMatch(output.join("\n"), /private-test-token|req-cli/);
});
