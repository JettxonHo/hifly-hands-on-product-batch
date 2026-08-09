import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package exposes explicit demo start, stop, reset, and missing migration CLI", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts.demo, "node scripts/demo.mjs");
  assert.equal(packageJson.scripts["demo:stop"], "node scripts/demo-stop.mjs");
  assert.equal(packageJson.scripts["demo:reset"], "node scripts/demo-reset.mjs");
  assert.equal(packageJson.scripts["migrate:manual-execution"], "node scripts/migrate-manual-execution.mjs");
});

test("demo compose definition is loopback-only and separate from identity compose", async () => {
  const compose = await readFile(new URL("../docker-compose.demo.yml", import.meta.url), "utf8");
  assert.match(compose, /127\.0\.0\.1:\$\{HIFLY_DEMO_DB_PORT:-55433\}:5432/);
  assert.match(compose, /hifly_vsa_demo_data/);
  assert.doesNotMatch(compose, /55432|hifly_identity_test|docker-compose\.identity/);
});
