import assert from "node:assert/strict";
import test from "node:test";

import { activateAdmin, identityApp, identityHeaders, login } from "./helpers/identity-world.js";

test("Hifly connection test is explicit, authenticated, and admin-only", async (t) => {
  let calls = 0;
  const { app } = await identityApp(t, {
    hiflyApi: {
      enabled: true,
      client: {
        async getAccountCredit() {
          calls += 1;
          return { left: 4321, requestId: "req-health" };
        }
      }
    }
  });

  assert.equal(calls, 0);
  assert.equal((await app.inject({
    method: "POST",
    url: "/api/providers/hifly/connection-test",
    headers: identityHeaders({ mutation: true }),
    payload: {}
  })).statusCode, 401);
  assert.equal(calls, 0);

  const admin = await activateAdmin(app);
  const response = await app.inject({
    method: "POST",
    url: "/api/providers/hifly/connection-test",
    headers: identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true }),
    payload: {}
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    provider: "hifly",
    status: "connected",
    account_credit: { left: 4321 },
    request_id: "req-health"
  });
  assert.equal(calls, 1);

  const memberCreated = (await app.inject({
    method: "POST",
    url: "/api/identity/members",
    headers: identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true }),
    payload: { email: "provider-member@example.test", display_name: "Provider Member", role: "member" }
  })).json();
  const member = await login(app, { email: "provider-member@example.test", password: memberCreated.temporary_password });
  await app.inject({
    method: "POST",
    url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true }),
    payload: { new_password: "Provider-Member-Password-9!" }
  });
  const forbidden = await app.inject({
    method: "POST",
    url: "/api/providers/hifly/connection-test",
    headers: identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true }),
    payload: {}
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error, "ADMIN_REQUIRED");
  assert.equal(calls, 1);
});

test("Hifly connection test exposes stable provider errors only", async (t) => {
  const { app } = await identityApp(t, {
    hiflyApi: {
      enabled: true,
      client: {
        async getAccountCredit() {
          throw Object.assign(new Error("https://provider.example/token=secret"), { code: "HIFLY_API_AUTH_INVALID" });
        }
      }
    }
  });
  const admin = await activateAdmin(app);
  const response = await app.inject({
    method: "POST",
    url: "/api/providers/hifly/connection-test",
    headers: identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true }),
    payload: {}
  });

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: "HIFLY_API_AUTH_INVALID" });
  assert.doesNotMatch(response.body, /secret|provider\.example/);
});
