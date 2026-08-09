import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_MIGRATION_ORDER,
  runDemoMigrations
} from "../scripts/demo-migrations.mjs";

test("demo migrations run every A01-A14 schema in dependency order", async () => {
  const calls = [];
  const steps = DEMO_MIGRATION_ORDER.map((name) => ({
    name,
    async run() {
      calls.push(name);
    }
  }));

  const applied = await runDemoMigrations({ connection: "test-double" }, { steps });

  assert.deepEqual(applied, DEMO_MIGRATION_ORDER);
  assert.deepEqual(calls, [
    "identity",
    "assets",
    "projectContent",
    "copyGeneration",
    "copyQuality",
    "copyReview",
    "avatarSelection",
    "videoPlanning",
    "productionOrders",
    "manualHandoff",
    "manualExecution",
    "artifactVerification",
    "workDelivery"
  ]);
});
