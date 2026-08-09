import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_CREDENTIALS,
  DEMO_FEATURES,
  createDemoConfig
} from "../src/server/demo-config.js";

test("demo config is independent, loopback-only, and enables the complete VSA surface", () => {
  const config = createDemoConfig({
    root: "/tmp/hifly-vsa-demo-test",
    port: 4399,
    databaseUrl: "postgresql://demo@127.0.0.1:55433/hifly_vsa_demo"
  });

  assert.equal(config.landingPath, "/login.html");
  assert.equal(config.generationConfig.executionBackend, "fake");
  assert.equal(config.generationConfig.rpa.mode, "mock");
  assert.equal(config.generationConfig.rpa.realLive.enabled, false);
  assert.equal(config.generationConfig.rpa.realLive.batch.enabled, false);
  assert.deepEqual(config.generationConfig.rpa.realLive.allowedHosts, []);
  assert.deepEqual(config.generationConfig.rpa.realLive.allowedDomains, []);
  assert.equal(config.generationConfig.hiflyWorkbenchUrl, undefined);
  assert.equal(config.generationConfig.handsOnProductUrl, undefined);
  assert.equal(config.generationConfig.__configPath, undefined);

  for (const feature of DEMO_FEATURES) {
    assert.equal(config[feature].enabled, true, feature);
  }
  assert.equal(config.identity.databaseUrl, "postgresql://demo@127.0.0.1:55433/hifly_vsa_demo");
  assert.deepEqual(config.identity.trustedHosts, ["127.0.0.1:4399"]);
  assert.deepEqual(config.identity.trustedOrigins, ["http://127.0.0.1:4399"]);
  assert.equal(config.identity.cookieSecure, false);
  assert.deepEqual(config.identity.seed, {
    enabled: true,
    organizationId: "org_demo_local",
    organizationName: "本地演示企业",
    adminEmail: DEMO_CREDENTIALS.email,
    adminDisplayName: "本地演示管理员",
    adminTempPassword: DEMO_CREDENTIALS.temporaryPassword
  });
  assert.match(DEMO_CREDENTIALS.email, /@demo\.local$/);
  assert.match(DEMO_CREDENTIALS.temporaryPassword, /^Demo-Local-/);
  assert.notEqual(DEMO_CREDENTIALS.temporaryPassword, "CHANGE_ME_initial_temp_password");
  assert.throws(
    () => createDemoConfig({
      root: "/tmp/hifly-vsa-demo-test",
      port: 4399,
      databaseUrl: "postgresql://demo@example.com/hifly_vsa_demo"
    }),
    { code: "DEMO_DATABASE_MUST_BE_LOCAL" }
  );
});
